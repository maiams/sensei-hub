'use client'

import { SetupPage } from '@sensei-hub/core-web'

export default function Setup() {
  return (
    <SetupPage
      productName="Sensei Arena"
      subtitle="Configure a organização anfitriã para começar."
      organizationLabel="Nome da organização"
      organizationPlaceholder="Ex: Liga Municipal de Judô"
    />
  )
}
