'use client'

import { LoginPage } from '@sensei-hub/core-web'

export default function Login() {
  return <LoginPage productName="Sensei Arena" subtitle="Entre com sua conta da organização." afterLoginHref="/events" />
}
