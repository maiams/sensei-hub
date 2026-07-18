'use client'

import { LoginPage } from '@sensei-hub/core-web'

export default function Login() {
  return <LoginPage productName="Sensei Dojô" subtitle="Entre com sua conta da academia." afterLoginHref="/athletes" />
}
