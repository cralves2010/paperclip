import { context, header, section, type HomeView } from './blocks.js'

/** Privacy is enforced in-app: App Home has no native per-user ACL. */
export function isAllowed(userId: string, allowlist: string[]): boolean {
  return allowlist.includes(userId)
}

export function buildPrivateView(): HomeView {
  return {
    type: 'home',
    blocks: [
      header('Agent M42'),
      section('🔒 *This app is private.*'),
      context('Ask Claudio for access.'),
    ],
  }
}
