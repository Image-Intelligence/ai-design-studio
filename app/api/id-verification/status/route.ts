import { cookies } from 'next/headers'
import { getUserFromSession } from '@/lib/auth'
import { jsonPrivate } from '@/lib/api-json'
import { checkIsAdmin } from '@/lib/admin-check'
import { getIdVerification, idVerificationAvailable } from '@/lib/id-verification'

/**
 * GET /api/id-verification/status -> { verified, status, termsAccepted, available, admin }
 *
 * What the page's upload locks read (and poll while the Didit tab is open).
 * `verified` is true for admins, who never need to verify.
 */
export async function GET() {
  const token = (await cookies()).get('session')?.value
  const user = token ? await getUserFromSession(token) : null
  if (!user) return jsonPrivate({ verified: false, status: null, termsAccepted: false, available: idVerificationAvailable(), admin: false, signedIn: false })
  const admin = await checkIsAdmin(user.email)
  const v = await getIdVerification(user.id)
  return jsonPrivate({ ...v, verified: admin || v.verified, available: idVerificationAvailable(), admin, signedIn: true })
}
