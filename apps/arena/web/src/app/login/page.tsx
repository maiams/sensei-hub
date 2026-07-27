'use client'

import { LoginPage } from '@sensei-hub/core-web'

// Where each role lands right after login. scoreboard_operator and
// weigh_in_operator don't have (and shouldn't get) permission to list every
// event, so sending them to /events would just show a 403 — /start resolves
// the one event actually in_progress and forwards them straight to their
// screen (mesa / pesagem). Everyone else keeps the existing /events landing.
function resolveAfterLoginHref(role: string | null): string {
  if (role === 'scoreboard_operator') return '/start?intent=operate'
  if (role === 'weigh_in_operator') return '/start?intent=weighin'
  return '/events'
}

export default function Login() {
  return (
    <LoginPage
      productName="Sensei Arena"
      subtitle="Entre com sua conta da organização."
      afterLoginHref="/events"
      resolveAfterLoginHref={resolveAfterLoginHref}
    />
  )
}
