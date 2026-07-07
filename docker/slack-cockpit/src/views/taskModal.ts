import { actions, button, confirmDialog, context, divider, section, sectionFields, type Block, type ModalView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, isDeliveredWithoutLink, type Comment, type Task } from '../model.js'
import { normalizeActor } from '../normalize.js'
import { clamp, taskRef, truncateTitle } from '../text.js'
import { verdictsFor } from '../verdicts.js'
import { deriveAsk, STATUS_EXPLAINER, type ViewerActor } from './didactic.js'

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
  const ask = deriveAsk(task, viewer)
  const move = normalizeActor(task.ownerNext)

  const blocks: Block[] = [
    // (1) Kicker: the Task ref + status, above the title.
    context(`\`${taskRef(task)}\` · ${STATUS_EMOJI[task.status]} ${STATUS_LABEL[task.status]}`),
    // (2) Bold title (modal title is truncated to 24; this is the full one).
    section(`*${task.title}*`),
    // (3) Hero — what (if anything) is being asked of the viewer.
    section(`*${ask.label}*\n${ask.body}`),
    // (4) Where it stands — status + its plain-English gloss.
    section(`*Where it stands*\n${STATUS_EMOJI[task.status]} ${STATUS_LABEL[task.status]} — ${STATUS_EXPLAINER[task.status]}`),
  ]

  // (4b) Your decision — Derek's verdict buttons, rendered ONLY for Derek and
  // (for the forward verdicts) only when it's his move. Direct-write verdicts
  // carry a native confirm (mis-tap guard); Request-changes / Answer open a
  // required-reason modal instead. Every write is CAS-guarded + reversible.
  const verdicts = verdictsFor(task, viewer === 'derek', move === 'derek')
  if (verdicts.length > 0) {
    blocks.push(
      context('*✅ Your decision*'),
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
    blocks.push(context(`⚠️ *Marked ${task.status === 'done' ? 'done' : 'delivered'}, but no access link is attached — Derek can’t open the deliverable yet.*`))
  else blocks.push(context('_No deliverable linked yet._'))

  // (9) Comments — count + up to the last 5, then an add button.
  const forTask = comments.filter((c) => c.taskNum === task.taskNum)
  blocks.push(divider(), section(`*Comments (${forTask.length})*`))
  for (const c of forTask.slice(-5)) {
    blocks.push(context(`*${c.author || '—'}* · ${commentDate(c.timestamp)} — ${clamp(c.text, 300)}`))
  }
  blocks.push(actions([button('💬 Add comment', `comment:${task.taskNum}`, { primary: true })]))

  return {
    type: 'modal',
    title: { type: 'plain_text', text: truncateTitle(task.title) },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  }
}
