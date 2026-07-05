import { actions, button, context, divider, section, sectionFields, type Block, type ModalView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, type Comment, type Task } from '../model.js'
import { clamp, truncateTitle } from '../text.js'

function commentDate(ts: string): string {
  // Prefer YYYY-MM-DD; fall back to the raw timestamp if unparseable.
  const d = Date.parse(ts)
  return Number.isNaN(d) ? ts : new Date(d).toISOString().slice(0, 10)
}

export function buildTaskModal(task: Task, comments: Comment[] = []): ModalView {
  const blocks: Block[] = [
    section(`*${task.title}*`), // full title (modal title is truncated to 24)
    sectionFields([
      `*Status*\n${STATUS_EMOJI[task.status]} ${STATUS_LABEL[task.status]}`,
      `*Company*\n\`${task.company}\``,
      `*Task ID*\n\`${task.company}-${task.taskNum}\``,
      `*Owner*\n${task.owner || '—'}`,
    ]),
    divider(),
    section(`*Deliverable*\n${task.deliverableTitle || task.title}`),
  ]

  const urlButtons: Block[] = []
  if (task.deliverableDriveUrl) urlButtons.push(button('📄 Open in Drive', 'url_drive', { url: task.deliverableDriveUrl }))
  if (task.deliverableSlackUrl) urlButtons.push(button('💬 Open in Slack', 'url_slack', { url: task.deliverableSlackUrl }))
  if (task.deliverableOtherUrl) urlButtons.push(button('🔗 Open link', 'url_other', { url: task.deliverableOtherUrl }))
  if (urlButtons.length > 0) blocks.push(actions(urlButtons))
  else blocks.push(context('_No deliverable linked yet._'))

  if (task.description) {
    blocks.push(divider(), section(`*Description*\n${clamp(task.description, 2900)}`))
  }
  if (task.dependency) {
    blocks.push(section(`*What's left*\n${clamp(task.dependency, 1900)}`))
  }

  // Comments (feature 1): show the count + up to the last 5, then an add button.
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
