import { redirect } from 'next/navigation'

// The old "Select a Tool" studio-selection page (legacy + video scanners) is retired.
// Anything still linking to /prompting-studio now lands on the dashboard.
export default function PromptingStudioRetired() {
  redirect('/dashboard')
}
