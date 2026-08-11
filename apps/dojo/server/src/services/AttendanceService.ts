import mongoose, { isValidObjectId, type ClientSession, type Types } from 'mongoose'
import { AuditLogModel, UserModel, type AuthCtx } from '@sensei-hub/core-server'
import type {
  CreateAttendanceRequestInput,
  CreateLessonInput,
  CreateTrainingClassInput,
  UpdateTrainingClassInput,
} from '@dojo/shared'
import { AthleteModel } from '../repositories/AthleteModel.js'
import { TrainingClassModel, type TrainingClassDocument } from '../repositories/TrainingClassModel.js'
import { ClassEnrollmentModel, type ClassEnrollmentDocument } from '../repositories/ClassEnrollmentModel.js'
import { LessonModel, type LessonDocument } from '../repositories/LessonModel.js'
import { AttendanceRecordModel, type AttendanceRecordDocument } from '../repositories/AttendanceRecordModel.js'
import { AttendanceRequestModel, type AttendanceRequestDocument } from '../repositories/AttendanceRequestModel.js'
import { AttendanceEventModel } from '../repositories/AttendanceEventModel.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function normalizedName(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function assertId(id: string): void {
  if (!isValidObjectId(id)) throw new AttendanceServiceError('Invalid id', 400)
}

export class AttendanceService {
  async createClass(data: CreateTrainingClassInput, ctx: AuthCtx) {
    try {
      const item = await TrainingClassModel.create({
        academyId: ctx.academyId,
        name: data.name,
        nameNormalized: normalizedName(data.name),
        description: data.description,
      })
      await this.#audit(item._id, 'TrainingClass', 'create', ctx)
      return this.#classDTO(item)
    } catch (err) {
      if (this.#duplicate(err)) throw new AttendanceServiceError('Class name already exists', 409)
      throw err
    }
  }

  async listClasses(academyId: string) {
    const items = await TrainingClassModel.find({ academyId }).sort({ nameNormalized: 1 })
    return items.map((item) => this.#classDTO(item))
  }

  async updateClass(id: string, data: UpdateTrainingClassInput, ctx: AuthCtx) {
    assertId(id)
    const item = await TrainingClassModel.findOne({ _id: id, academyId: ctx.academyId })
    if (!item) throw new AttendanceServiceError('Class not found', 404)
    const oldValue = this.#classDTO(item)
    if (data.name !== undefined) {
      item.name = data.name
      item.nameNormalized = normalizedName(data.name)
    }
    if (data.description !== undefined) item.description = data.description
    if (data.active !== undefined) item.active = data.active
    try {
      await item.save()
    } catch (err) {
      if (this.#duplicate(err)) throw new AttendanceServiceError('Class name already exists', 409)
      throw err
    }
    await this.#audit(item._id, 'TrainingClass', 'update', ctx, oldValue, this.#classDTO(item))
    return this.#classDTO(item)
  }

  async addEnrollment(classId: string, athleteId: string, ctx: AuthCtx) {
    assertId(classId); assertId(athleteId)
    const [trainingClass, athlete] = await Promise.all([
      TrainingClassModel.findOne({ _id: classId, academyId: ctx.academyId, active: true }),
      AthleteModel.findOne({ _id: athleteId, academyId: ctx.academyId, status: { $in: ['active', 'pending'] } }),
    ])
    if (!trainingClass) throw new AttendanceServiceError('Class not found', 404)
    if (!athlete) throw new AttendanceServiceError('Athlete not found', 404)
    try {
      const enrollment = await ClassEnrollmentModel.create({
        academyId: ctx.academyId, classId, athleteId, createdBy: ctx.userId,
      })
      await this.#audit(enrollment._id, 'ClassEnrollment', 'create', ctx)
      return this.#enrollmentDTO(enrollment, athlete.fullName)
    } catch (err) {
      if (this.#duplicate(err)) throw new AttendanceServiceError('Athlete already has an active enrollment', 409)
      throw err
    }
  }

  async listEnrollments(classId: string, academyId: string) {
    assertId(classId)
    const exists = await TrainingClassModel.exists({ _id: classId, academyId })
    if (!exists) throw new AttendanceServiceError('Class not found', 404)
    const enrollments = await ClassEnrollmentModel.find({ academyId, classId }).sort({ active: -1, startedAt: -1 })
    const athleteIds = enrollments.map((e) => e.athleteId)
    const athletes = await AthleteModel.find({ academyId, _id: { $in: athleteIds } }).select('fullName')
    const names = new Map(athletes.map((a) => [a._id.toString(), a.fullName]))
    return enrollments.map((e) => this.#enrollmentDTO(e, names.get(e.athleteId.toString()) ?? 'Atleta'))
  }

  async endEnrollment(id: string, reason: string, ctx: AuthCtx) {
    assertId(id)
    const now = new Date()
    const item = await ClassEnrollmentModel.findOneAndUpdate(
      { _id: id, academyId: ctx.academyId, active: true },
      { $set: { active: false, endedAt: now, endedBy: ctx.userId, endReason: reason } },
      { new: true },
    )
    if (!item) throw new AttendanceServiceError('Active enrollment not found', 404)
    await this.#audit(item._id, 'ClassEnrollment', 'update', ctx, { active: true }, { active: false }, reason)
  }

  async createLesson(data: CreateLessonInput, ctx: AuthCtx) {
    assertId(data.classId)
    const startsAt = new Date(data.startsAt)
    const endsAt = new Date(data.endsAt)
    if (endsAt <= startsAt) throw new AttendanceServiceError('Lesson end must be after start', 400)
    const coachId = data.coachId ?? ctx.userId
    assertId(coachId)
    const [trainingClass, coach] = await Promise.all([
      TrainingClassModel.findOne({ _id: data.classId, academyId: ctx.academyId, active: true }),
      UserModel.findOne({ _id: coachId, academyId: ctx.academyId, role: { $in: ['coach', 'academy_admin', 'super_admin'] }, active: true }),
    ])
    if (!trainingClass) throw new AttendanceServiceError('Class not found', 404)
    if (!coach) throw new AttendanceServiceError('Coach not found', 404)

    const session = await mongoose.startSession()
    try {
      let lesson: LessonDocument | undefined
      await session.withTransaction(async () => {
        const created = await LessonModel.create([{
          academyId: ctx.academyId,
          classId: data.classId,
          coachId,
          startsAt,
          endsAt,
          requestOpensAt: new Date(startsAt.getTime() - 30 * MINUTE),
          requestClosesAt: new Date(startsAt.getTime() + 60 * MINUTE),
          decisionDeadlineAt: new Date(endsAt.getTime() + 24 * HOUR),
        }], { session })
        lesson = created[0]
        if (!lesson) throw new Error('Lesson creation returned no document')
        const enrollments = await ClassEnrollmentModel.find({ academyId: ctx.academyId, classId: data.classId, active: true }).session(session)
        if (enrollments.length) {
          const records = await AttendanceRecordModel.create(enrollments.map((e) => ({
            academyId: ctx.academyId, lessonId: lesson!._id, classId: data.classId, athleteId: e.athleteId,
          })), { session })
          await AttendanceEventModel.create(records.map((r) => ({
            academyId: ctx.academyId, lessonId: lesson!._id, classId: data.classId,
            athleteId: r.athleteId, attendanceId: r._id, type: 'roster_added', actorId: ctx.userId,
          })), { session })
        }
        await AuditLogModel.create([{
          userId: ctx.userId, entityType: 'Lesson', entityId: lesson._id, action: 'create',
          sessionId: ctx.sessionId, ip: ctx.ip,
        }], { session })
      })
      if (!lesson) throw new Error('Lesson transaction did not produce a document')
      return this.#lessonDTO(lesson, trainingClass.name)
    } catch (err) {
      if (this.#duplicate(err)) throw new AttendanceServiceError('A lesson already exists for this class and start time', 409)
      throw err
    } finally {
      await session.endSession()
    }
  }

  async listLessons(academyId: string, filters: { from?: Date; to?: Date; classId?: string; athleteUserId?: string }) {
    const query: Record<string, unknown> = { academyId }
    if (filters.classId) query.classId = filters.classId
    if (filters.from || filters.to) query.startsAt = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) }
    if (filters.athleteUserId) {
      const athlete = await AthleteModel.findOne({ academyId, userId: filters.athleteUserId })
      if (!athlete) return []
      const enrollments = await ClassEnrollmentModel.find({ academyId, athleteId: athlete._id })
      query.classId = { $in: enrollments.map((e) => e.classId) }
    }
    const lessons = await LessonModel.find(query).sort({ startsAt: 1 })
    const classes = await TrainingClassModel.find({ academyId, _id: { $in: lessons.map((l) => l.classId) } })
    const names = new Map(classes.map((c) => [c._id.toString(), c.name]))
    return lessons.map((l) => this.#lessonDTO(l, names.get(l.classId.toString()) ?? 'Turma'))
  }

  async studentDashboard(ctx: AuthCtx) {
    const athlete = await AthleteModel.findOne({ academyId: ctx.academyId, userId: ctx.userId })
    if (!athlete) throw new AttendanceServiceError('No athlete linked to this user', 404)
    const enrollment = await ClassEnrollmentModel.findOne({ academyId: ctx.academyId, athleteId: athlete._id, active: true })
    const trainingClass = enrollment ? await TrainingClassModel.findOne({ _id: enrollment.classId, academyId: ctx.academyId }) : null
    const lesson = enrollment ? await LessonModel.findOne({ academyId: ctx.academyId, classId: enrollment.classId, status: 'scheduled', startsAt: { $gte: new Date(Date.now() - HOUR) } }).sort({ startsAt: 1 }) : null
    if (lesson) await this.#finalizeLesson(lesson, ctx)
    const request = lesson ? await AttendanceRequestModel.findOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId: athlete._id }) : null
    const attendance = lesson ? await AttendanceRecordModel.findOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId: athlete._id }) : null
    return {
      athlete: { id: athlete._id.toString(), fullName: athlete.fullName },
      currentClass: trainingClass ? { id: trainingClass._id.toString(), name: trainingClass.name } : undefined,
      nextLesson: lesson && trainingClass ? this.#lessonDTO(lesson, trainingClass.name) : undefined,
      request: request ? this.#requestDTO(request) : undefined,
      attendance: attendance && lesson && trainingClass ? this.#attendanceDTO(attendance, lesson, trainingClass.name) : undefined,
    }
  }

  async studentAttendance(ctx: AuthCtx, from?: Date, to?: Date) {
    const athlete = await AthleteModel.findOne({ academyId: ctx.academyId, userId: ctx.userId })
    if (!athlete) throw new AttendanceServiceError('No athlete linked to this user', 404)
    const lessons = await LessonModel.find({ academyId: ctx.academyId, ...(from || to ? { startsAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) })
    const lessonMap = new Map(lessons.map((l) => [l._id.toString(), l]))
    const records = await AttendanceRecordModel.find({ academyId: ctx.academyId, athleteId: athlete._id, lessonId: { $in: lessons.map((l) => l._id) } }).sort({ createdAt: -1 })
    const classes = await TrainingClassModel.find({ academyId: ctx.academyId, _id: { $in: records.map((r) => r.classId) } })
    const names = new Map(classes.map((c) => [c._id.toString(), c.name]))
    return records.flatMap((r) => {
      const lesson = lessonMap.get(r.lessonId.toString())
      return lesson ? [this.#attendanceDTO(r, lesson, names.get(r.classId.toString()) ?? 'Turma')] : []
    }).sort((a, b) => b.lessonStartsAt.localeCompare(a.lessonStartsAt))
  }

  async rollCall(lessonId: string, ctx: AuthCtx) {
    const lesson = await this.#getLesson(lessonId, ctx.academyId)
    this.#assertCoachAccess(lesson, ctx)
    await this.#syncRoster(lesson, ctx)
    await this.#finalizeLesson(lesson, ctx)
    const [trainingClass, records, requests] = await Promise.all([
      TrainingClassModel.findOne({ _id: lesson.classId, academyId: ctx.academyId }),
      AttendanceRecordModel.find({ academyId: ctx.academyId, lessonId: lesson._id }),
      AttendanceRequestModel.find({ academyId: ctx.academyId, lessonId: lesson._id }),
    ])
    if (!trainingClass) throw new AttendanceServiceError('Class not found', 404)
    const athletes = await AthleteModel.find({ academyId: ctx.academyId, _id: { $in: records.map((r) => r.athleteId) } }).select('fullName birthDate')
    const athleteMap = new Map(athletes.map((a) => [a._id.toString(), a]))
    const requestMap = new Map(requests.map((r) => [r.athleteId.toString(), r]))
    const items = records.map((record) => {
      const athlete = athleteMap.get(record.athleteId.toString())
      const request = requestMap.get(record.athleteId.toString())
      return {
        attendanceId: record._id.toString(), athleteId: record.athleteId.toString(),
        athleteName: athlete?.fullName ?? 'Atleta', birthDate: athlete?.birthDate,
        result: record.result, source: record.source, version: record.version,
        request: request ? this.#requestDTO(request) : undefined,
      }
    }).sort((a, b) => a.athleteName.localeCompare(b.athleteName, 'pt-BR'))
    return { lesson: this.#lessonDTO(lesson, trainingClass.name), items }
  }

  async requestAttendance(lessonId: string, data: CreateAttendanceRequestInput, ctx: AuthCtx) {
    const lesson = await this.#getLesson(lessonId, ctx.academyId)
    const now = new Date()
    if (lesson.status !== 'scheduled') throw new AttendanceServiceError('Lesson is not available', 422)
    if (now < lesson.requestOpensAt) throw new AttendanceServiceError('Attendance request window is not open', 422)
    if (now > lesson.requestClosesAt) throw new AttendanceServiceError('Attendance request window is closed', 422)
    const athlete = await AthleteModel.findOne({ academyId: ctx.academyId, userId: ctx.userId, status: 'active' })
    if (!athlete) throw new AttendanceServiceError('No active athlete linked to this user', 404)
    const enrollment = await ClassEnrollmentModel.findOne({ academyId: ctx.academyId, classId: lesson.classId, athleteId: athlete._id, active: true })
    if (!enrollment) throw new AttendanceServiceError('No active enrollment for this lesson', 422)
    await this.#ensureRosterRecord(lesson, athlete._id, ctx)
    const session = await mongoose.startSession()
    try {
      const location = data.location
      let request: AttendanceRequestDocument | undefined
      await session.withTransaction(async () => {
        const created = await AttendanceRequestModel.create([{
          academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId: athlete._id,
          locationStatus: location?.status ?? 'unavailable', distanceMeters: location?.distanceMeters,
          accuracyMeters: location?.accuracyMeters, clientCapturedAt: location?.capturedAt ? new Date(location.capturedAt) : undefined,
        }], { session })
        request = created[0]
        if (!request) throw new Error('Attendance request creation returned no document')
        await AttendanceRecordModel.updateOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId: athlete._id }, { $set: { requestId: request._id, source: 'student_request' } }, { session })
        await AttendanceEventModel.create([{ academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId: athlete._id, requestId: request._id, type: 'requested', actorId: ctx.userId }], { session })
        await AuditLogModel.create([{ userId: ctx.userId, entityType: 'AttendanceRequest', entityId: request._id, action: 'create', sessionId: ctx.sessionId, ip: ctx.ip }], { session })
      })
      if (!request) throw new Error('Attendance request transaction did not produce a document')
      return this.#requestDTO(request)
    } catch (err) {
      if (this.#duplicate(err)) throw new AttendanceServiceError('Attendance request already exists', 409)
      throw err
    } finally { await session.endSession() }
  }

  async confirmRequest(requestId: string, ctx: AuthCtx) {
    return this.#decideRequest(requestId, 'confirmed', undefined, ctx)
  }

  async rejectRequest(requestId: string, reason: string, ctx: AuthCtx) {
    return this.#decideRequest(requestId, 'rejected', reason, ctx)
  }

  async directPresence(lessonId: string, athleteId: string, reason: string | undefined, ctx: AuthCtx) {
    const lesson = await this.#getLesson(lessonId, ctx.academyId)
    this.#assertCoachAccess(lesson, ctx)
    assertId(athleteId)
    const athlete = await AthleteModel.findOne({ _id: athleteId, academyId: ctx.academyId })
    if (!athlete) throw new AttendanceServiceError('Athlete not found', 404)
    const enrollment = await ClassEnrollmentModel.findOne({ academyId: ctx.academyId, classId: lesson.classId, athleteId, active: true })
    if (!enrollment) throw new AttendanceServiceError('Athlete is not enrolled in this class', 422)
    await this.#ensureRosterRecord(lesson, athlete._id, ctx)
    const pending = await AttendanceRequestModel.findOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId, status: 'pending' })
    if (pending) {
      await this.#decideRequest(pending._id.toString(), 'confirmed', reason, ctx)
    } else {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const record = await AttendanceRecordModel.findOneAndUpdate(
            { academyId: ctx.academyId, lessonId: lesson._id, athleteId, result: { $ne: 'present' } },
            { $set: { result: 'present', source: 'coach_entry', recordedAt: new Date(), recordedBy: ctx.userId }, $inc: { version: 1 } },
            { new: true, session },
          )
          if (!record) throw new AttendanceServiceError('Attendance is already present', 409)
          await AttendanceEventModel.create([{ academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId, attendanceId: record._id, type: 'direct_present', actorId: ctx.userId, toResult: 'present', reason }], { session })
          await AuditLogModel.create([{ userId: ctx.userId, entityType: 'AttendanceRecord', entityId: record._id, action: 'update', newValue: { result: 'present' }, reason, sessionId: ctx.sessionId, ip: ctx.ip }], { session })
        })
      } finally { await session.endSession() }
    }
    const record = await AttendanceRecordModel.findOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId })
    if (!record) throw new AttendanceServiceError('Attendance record not found', 404)
    const trainingClass = await TrainingClassModel.findOne({ _id: lesson.classId, academyId: ctx.academyId })
    return this.#attendanceDTO(record, lesson, trainingClass?.name ?? 'Turma')
  }

  async correctAttendance(attendanceId: string, result: 'present' | 'absent', reason: string, ctx: AuthCtx) {
    assertId(attendanceId)
    const record = await AttendanceRecordModel.findOne({ _id: attendanceId, academyId: ctx.academyId })
    if (!record) throw new AttendanceServiceError('Attendance record not found', 404)
    const lesson = await this.#getLesson(record.lessonId.toString(), ctx.academyId)
    this.#assertCoachAccess(lesson, ctx)
    const isAdmin = ctx.role === 'academy_admin' || ctx.role === 'super_admin'
    if (!isAdmin && new Date() > lesson.decisionDeadlineAt) throw new AttendanceServiceError('Correction window is closed', 422)
    if (record.result === result) throw new AttendanceServiceError('Attendance already has this result', 409)
    const oldResult = record.result
    const session = await mongoose.startSession()
    let corrected: AttendanceRecordDocument | null = null
    try {
      await session.withTransaction(async () => {
        const updated = await AttendanceRecordModel.findOneAndUpdate(
          { _id: record._id, academyId: ctx.academyId, version: record.version, result: oldResult },
          { $set: { result, source: 'correction', recordedAt: new Date(), recordedBy: ctx.userId }, $inc: { version: 1 } },
          { new: true, session },
        )
        if (!updated) throw new AttendanceServiceError('Attendance changed concurrently; reload and try again', 409)
        await AttendanceEventModel.create([{ academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId: updated.athleteId, attendanceId: updated._id, type: 'corrected', actorId: ctx.userId, fromResult: oldResult, toResult: result, reason }], { session })
        await AuditLogModel.create([{ userId: ctx.userId, entityType: 'AttendanceRecord', entityId: updated._id, action: 'update', oldValue: { result: oldResult }, newValue: { result }, reason, sessionId: ctx.sessionId, ip: ctx.ip }], { session })
        corrected = updated
      })
    } finally { await session.endSession() }
    const trainingClass = await TrainingClassModel.findOne({ _id: lesson.classId, academyId: ctx.academyId })
    if (!corrected) throw new Error('Attendance correction transaction did not produce a document')
    return this.#attendanceDTO(corrected, lesson, trainingClass?.name ?? 'Turma')
  }

  async #decideRequest(requestId: string, status: 'confirmed' | 'rejected', reason: string | undefined, ctx: AuthCtx) {
    assertId(requestId)
    const existing = await AttendanceRequestModel.findOne({ _id: requestId, academyId: ctx.academyId })
    if (!existing) throw new AttendanceServiceError('Attendance request not found', 404)
    const lesson = await this.#getLesson(existing.lessonId.toString(), ctx.academyId)
    this.#assertCoachAccess(lesson, ctx)
    if (new Date() > lesson.decisionDeadlineAt) throw new AttendanceServiceError('Decision window is closed', 422)
    const session = await mongoose.startSession()
    try {
      let decided: AttendanceRequestDocument | null = null
      await session.withTransaction(async () => {
        decided = await AttendanceRequestModel.findOneAndUpdate(
          { _id: requestId, academyId: ctx.academyId, status: 'pending' },
          { $set: { status, decidedAt: new Date(), decidedBy: ctx.userId, ...(status === 'rejected' ? { rejectionReason: reason } : {}) } },
          { new: true, session },
        )
        if (!decided) throw new AttendanceServiceError('Attendance request is no longer pending', 409)
        const result = status === 'confirmed' ? 'present' : 'absent'
        const source = status === 'confirmed' ? 'student_request' : 'request_rejected'
        const record = await AttendanceRecordModel.findOneAndUpdate(
          { academyId: ctx.academyId, lessonId: lesson._id, athleteId: decided.athleteId },
          { $set: { result, source, requestId: decided._id, recordedAt: new Date(), recordedBy: ctx.userId }, $inc: { version: 1 } },
          { new: true, upsert: true, session },
        )
        await AttendanceEventModel.create([{
          academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId,
          athleteId: decided.athleteId, attendanceId: record._id, requestId: decided._id,
          type: status, actorId: ctx.userId, toResult: result, reason,
        }], { session })
        await AuditLogModel.create([{
          userId: ctx.userId, entityType: 'AttendanceRequest', entityId: decided._id,
          action: 'update', fieldName: 'status', oldValue: 'pending', newValue: status,
          reason, sessionId: ctx.sessionId, ip: ctx.ip,
        }], { session })
      })
      if (!decided) throw new AttendanceServiceError('Attendance request is no longer pending', 409)
      return this.#requestDTO(decided)
    } finally {
      await session.endSession()
    }
  }

  async #syncRoster(lesson: LessonDocument, ctx: AuthCtx) {
    const enrollments = await ClassEnrollmentModel.find({ academyId: ctx.academyId, classId: lesson.classId, active: true })
    for (const enrollment of enrollments) await this.#ensureRosterRecord(lesson, enrollment.athleteId, ctx)
  }

  async #ensureRosterRecord(lesson: LessonDocument, athleteId: Types.ObjectId, ctx: AuthCtx) {
    const result = await AttendanceRecordModel.updateOne(
      { academyId: ctx.academyId, lessonId: lesson._id, athleteId },
      { $setOnInsert: { academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId, result: 'unmarked', source: 'roster', version: 0 } },
      { upsert: true },
    )
    if (result.upsertedCount) {
      const record = await AttendanceRecordModel.findOne({ academyId: ctx.academyId, lessonId: lesson._id, athleteId })
      await AttendanceEventModel.create({ academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId, attendanceId: record?._id, type: 'roster_added', actorId: ctx.userId })
    }
  }

  async #finalizeLesson(lesson: LessonDocument, ctx: AuthCtx) {
    if (lesson.status !== 'scheduled' || new Date() <= lesson.decisionDeadlineAt) return
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        const pending = await AttendanceRequestModel.find({ academyId: ctx.academyId, lessonId: lesson._id, status: 'pending' }).session(session)
        for (const request of pending) {
          request.status = 'expired'; request.decidedAt = new Date(); request.expirationReason = 'Solicitação expirada sem decisão'
          await request.save({ session })
          await AttendanceRecordModel.updateOne(
            { academyId: ctx.academyId, lessonId: lesson._id, athleteId: request.athleteId },
            { $set: { result: 'absent', source: 'request_expired', requestId: request._id, recordedAt: new Date() }, $inc: { version: 1 } }, { session },
          )
          await AttendanceEventModel.create([{ academyId: ctx.academyId, lessonId: lesson._id, classId: lesson.classId, athleteId: request.athleteId, requestId: request._id, type: 'expired', toResult: 'absent', reason: request.expirationReason }], { session })
        }
        await AttendanceRecordModel.updateMany({ academyId: ctx.academyId, lessonId: lesson._id, result: 'unmarked' }, { $set: { result: 'absent', source: 'no_request', recordedAt: new Date() }, $inc: { version: 1 } }, { session })
        await LessonModel.updateOne({ _id: lesson._id, academyId: ctx.academyId, status: 'scheduled' }, { $set: { status: 'closed' } }, { session })
      })
      lesson.status = 'closed'
    } finally { await session.endSession() }
  }

  async #getLesson(id: string, academyId: string) {
    assertId(id)
    const lesson = await LessonModel.findOne({ _id: id, academyId })
    if (!lesson) throw new AttendanceServiceError('Lesson not found', 404)
    return lesson
  }

  #assertCoachAccess(lesson: LessonDocument, ctx: AuthCtx) {
    if (ctx.role === 'academy_admin' || ctx.role === 'super_admin') return
    if (ctx.role !== 'coach' || lesson.coachId.toString() !== ctx.userId) throw new AttendanceServiceError('Forbidden', 403)
  }

  #classDTO(item: TrainingClassDocument) {
    return { id: item._id.toString(), name: item.name, description: item.description, active: item.active, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }
  }

  #enrollmentDTO(item: ClassEnrollmentDocument, athleteName: string) {
    return { id: item._id.toString(), classId: item.classId.toString(), athleteId: item.athleteId.toString(), athleteName, active: item.active, startedAt: item.startedAt.toISOString(), endedAt: item.endedAt?.toISOString() }
  }

  #lessonDTO(item: LessonDocument, className: string) {
    return { id: item._id.toString(), classId: item.classId.toString(), className, coachId: item.coachId.toString(), startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString(), requestOpensAt: item.requestOpensAt.toISOString(), requestClosesAt: item.requestClosesAt.toISOString(), decisionDeadlineAt: item.decisionDeadlineAt.toISOString(), status: item.status }
  }

  #requestDTO(item: AttendanceRequestDocument) {
    return { id: item._id.toString(), lessonId: item.lessonId.toString(), classId: item.classId.toString(), athleteId: item.athleteId.toString(), status: item.status, requestedAt: item.requestedAt.toISOString(), locationStatus: item.locationStatus, distanceMeters: item.distanceMeters, accuracyMeters: item.accuracyMeters, rejectionReason: item.rejectionReason, expirationReason: item.expirationReason, decidedAt: item.decidedAt?.toISOString() }
  }

  #attendanceDTO(item: AttendanceRecordDocument, lesson: LessonDocument, className: string) {
    return { id: item._id.toString(), lessonId: item.lessonId.toString(), classId: item.classId.toString(), className, lessonStartsAt: lesson.startsAt.toISOString(), lessonEndsAt: lesson.endsAt.toISOString(), result: item.result, source: item.source, recordedAt: item.recordedAt?.toISOString(), version: item.version }
  }

  async #audit(entityId: Types.ObjectId, entityType: string, action: 'create' | 'update', ctx: AuthCtx, oldValue?: unknown, newValue?: unknown, reason?: string) {
    await AuditLogModel.create({ userId: ctx.userId, entityType, entityId, action, oldValue, newValue, reason, sessionId: ctx.sessionId, ip: ctx.ip })
  }

  #duplicate(err: unknown) { return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000 }
}

export class AttendanceServiceError extends Error {
  constructor(message: string, public readonly statusCode: 400 | 403 | 404 | 409 | 422) {
    super(message)
    this.name = 'AttendanceServiceError'
  }
}
