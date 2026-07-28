// Automation now lives inside Campaign Center as a tab. This keeps any old
// link or bookmark working instead of returning a 404.
import { redirect } from 'next/navigation';

export default function AutomationRedirect() {
  redirect('/campaigns');
}
