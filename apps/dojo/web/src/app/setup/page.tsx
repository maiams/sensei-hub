'use client'

import { SetupPage } from '@sensei-hub/core-web'

export default function Setup() {
  return (
    <SetupPage
      productName="Sensei Dojô"
      subtitle="Configure sua academia para começar."
      organizationLabel="Nome da academia"
      organizationPlaceholder="Ex: Dojo Centro"
      afterLoginHref="/athletes"
    />
  )
}
