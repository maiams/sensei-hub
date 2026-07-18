import { Schema, model, type Types } from 'mongoose'

export interface ImportRowErrorEntry {
  row: number
  field?: string
  message: string
}

export interface ImportJobDocument {
  _id: Types.ObjectId
  eventId: Types.ObjectId
  filename: string
  importedBy: Types.ObjectId
  importedAt: Date
  totalRows: number
  successCount: number
  errorCount: number
  errors: ImportRowErrorEntry[]
}

const importRowErrorSchema = new Schema<ImportRowErrorEntry>(
  {
    row: { type: Number, required: true },
    field: { type: String },
    message: { type: String, required: true },
  },
  { _id: false },
)

const importJobSchema = new Schema<ImportJobDocument>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    filename: { type: String, required: true },
    importedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    importedAt: { type: Date, required: true, default: () => new Date() },
    totalRows: { type: Number, required: true },
    successCount: { type: Number, required: true },
    errorCount: { type: Number, required: true },
    // "errors" collides with Document.prototype.errors (validation errors) —
    // harmless here since we only ever read/write it as a plain schema path.
    errors: { type: [importRowErrorSchema], required: true, default: [] },
  },
  { suppressReservedKeysWarning: true },
)

importJobSchema.index({ eventId: 1, importedAt: -1 })

export const ImportJobModel = model<ImportJobDocument>('ImportJob', importJobSchema)
