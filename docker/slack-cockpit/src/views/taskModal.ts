import { actions, button, confirmDialog, context, divider, section, sectionFields, type Block, type ModalView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, isDeliveredWithoutLink, type Comment, type Task } from '../model.js'
import { findInputDocUrl, DOC_MARKER_PREFIX } from '../docs.js'
import { normalizeActor } from '../normalize.js'
import { clamp, taskRef, truncateTitle } from '../text.js'
import { verdictsFor } from '../verdicts.js'
import { deriveActionLine, type ViewerActor } from './didactic.js'

function commentDate(ts: string): string {
  // Prefer YYYY-MM-DD; fall back to the raw timestamp if unparseable.
  const d = Date.parse(ts)
  return Number.isNaN(d) ? ts : new Date(d).toISOString().slice(0, 10)
}

/** Render text as a Slack mrkdwn blockquote — every line prefixed with "> ". */
function blockquote(s: string): string {
  return s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
}

/** Display name for whose move it is next (Owner-next column). */
const MOVE_DISPLAY: Record<'derek' | 'claudio' | 'team', string> = {
  derek: 'Derek',
  claudio: 'Claudio',
  team: 'The team',
}

export function buildTaskModal(task: Task, comments: Comment[] = [], viewer: ViewerActor = 'observer'): ModalView {
  const move = normalizeActor(task.ownerNext)
  // Compute the verdicts ONCE — the same value drives both the buttons and the
  // action line's affordance, so prose and buttons can never contradict (JRS-42 fix).
  const isPrincipal = viewer === 'derek' || viewer === 'claudio'
  const verdicts = verdictsFor(task, isPrincipal)
  const hasVerdicts = verdicts.length > 0

  const blocks: Block[] = [
    // (1) Kicker: the Task ref + status — the ONE and only place the status shows.
    context(`\`${taskRef(task)}\` · ${STATUS_EMOJI[task.status]} ${STATUS_LABEL[task.status]}`),
    // (2) Bold title (modal title is truncated to 24; this is the full one).
    section(`*${task.title}*`),
    // (3) Action line — whose move it is + what THIS viewer can do (old hero +
    // "Where it stands" merged; affordance gated on hasVerdicts, never on ownership).
    section(deriveActionLine(task, viewer, hasVerdicts)),
  ]

  // (4) Verdict buttons for a PRINCIPAL (Derek OR Claudio), keyed to status;
  // observers get none. The action line above already points at them ("…below"),
  // so no separate "Your decision" header. Direct-write verdicts carry a native
  // confirm (mis-tap guard); Request-changes / Answer open a required-reason modal.
  // Every write is CAS-guarded + reversible.
  if (hasVerdicts) {
    blocks.push(
      actions(
        verdicts.map((v) =>
          button(v.label, `verdict:${v.id}:${task.taskNum}`, {
            primary: v.primary,
            confirm: v.confirm ? confirmDialog(v.confirm.title, v.confirm.text, v.confirm.ok) : undefined,
          }),
        ),
      ),
    )
  }

  // (5) What this is — the team's own description, verbatim in a blockquote.
  if (task.description) {
    blocks.push(
      section(`*📋 What this is*\n${blockquote(clamp(task.description, 2900))}`),
      context('_The team’s working notes — may be shorthand._'),
    )
  }

  // (6) What's left / what's blocking it — the dependency, verbatim.
  if (task.dependency) {
    const heading = task.status === 'blocked' ? '*🚧 What’s blocking it*' : '*🚧 What’s left*'
    blocks.push(section(`${heading}\n${blockquote(clamp(task.dependency, 1900))}`))
  }

  // (7) Compact facts grid.
  const facts = [`*Owner*\n${task.owner || '—'}`]
  if (task.priority) facts.push(`*Priority*\n${task.priority}`)
  facts.push(`*Whose move*\n${MOVE_DISPLAY[move]}`)
  if (task.lastUpdated) facts.push(`*Updated*\n${task.lastUpdated}`)
  blocks.push(divider(), sectionFields(facts))

  // (8) Deliverable + url buttons.
  blocks.push(divider(), section(`*Deliverable*\n${task.deliverableTitle || task.title}`))
  const urlButtons: Block[] = []
  if (task.deliverableDriveUrl) urlButtons.push(button('📄 Open in Drive', 'url_drive', { url: task.deliverableDriveUrl }))
  if (task.deliverableSlackUrl) urlButtons.push(button('💬 Open in Slack', 'url_slack', { url: task.deliverableSlackUrl }))
  if (task.deliverableOtherUrl) urlButtons.push(button('🔗 Open link', 'url_other', { url: task.deliverableOtherUrl }))
  if (urlButtons.length > 0) blocks.push(actions(urlButtons))
  else if (isDeliveredWithoutLink(task))
    blocks.push(
      context(
        `⚠️ *Marked delivered, but no access link is attached${
          move === 'derek' || move === 'claudio' ? ` — ${MOVE_DISPLAY[move]} can’t open it yet` : ' yet'
        }.*`,
      ),
    )
  else blocks.push(context('_No deliverable linked yet._'))

  // (9) Comments — count + up to the last 5, then an add button.
  // Filter the machine input-doc MARKER out of the visible thread + count (the "📄 Open
  // input doc" button below already surfaces it); findInputDocUrl still sees it via `comments`.
  const forTask = comments.filter((c) => c.taskNum === task.taskNum && !c.text.startsWith(DOC_MARKER_PREFIX))
  blocks.push(divider(), section(`*Comments (${forTask.length})*`))
  for (const c of forTask.slice(-5)) {
    // 📎 hints a pasted link/attachment (Slack auto-links the URL in mrkdwn).
    const paperclip = /https?:\/\//i.test(c.text) ? '📎 ' : ''
    // 1500 (was 300): show the comment, not a teaser. A context element renders
    // small but holds it; one comment is ≤3000 (input cap), and the DM already
    // carries the full text. (Case 2026-07-08.)
    blocks.push(context(`${paperclip}*${c.author || '—'}* · ${commentDate(c.timestamp)} — ${clamp(c.text, 1500)}`))
  }
  const bottomRow: Block[] = [button('💬 Add comment', `comment:${task.taskNum}`, { primary: true })]
  const inputDocUrl = findInputDocUrl(comments, task.taskNum)
  if (inputDocUrl) {
    // A doc already exists → everyone gets a plain open-link (routes to the existing /^url_/ ack).
    bottomRow.push(button('📄 Open input doc', 'url_inputdoc', { url: inputDocUrl }))
  } else if (isPrincipal) {
    // No doc yet → only a principal may provision one (mints an org Doc owned by hello@).
    bottomRow.push(button('📄 Big text / table', `open_input_doc:${task.taskNum}`))
  }
  blocks.push(actions(bottomRow))

  return {
    type: 'modal',
    title: { type: 'plain_text', text: truncateTitle(task.title) },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  }
}
