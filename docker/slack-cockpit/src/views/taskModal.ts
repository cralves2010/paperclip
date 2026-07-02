import { actions, button, context, divider, section, sectionFields, type Block, type ModalView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, type Task } from '../model.js'
import { clamp, truncateTitle } from '../text.js'

export function buildTaskModal(task: Task): ModalView {
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
  blocks.push(context('Actions (approve · request changes · comment) coming in v1'))

  return {
    type: 'modal',
    title: { type: 'plain_text', text: truncateTitle(task.title) },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  }
}
