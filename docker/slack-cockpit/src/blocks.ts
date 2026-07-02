// Thin Block Kit builders. App Home is server-published Block Kit (no CSS),
// so every visual affordance is one of these blocks.

export type Block = Record<string, unknown>
export interface HomeView {
  type: 'home'
  blocks: Block[]
}
export interface ModalView {
  type: 'modal'
  callback_id?: string
  title: Block
  submit?: Block
  close?: Block
  blocks: Block[]
}

export const header = (text: string): Block => ({
  type: 'header',
  text: { type: 'plain_text', text, emoji: true },
})

export const section = (text: string, accessory?: Block): Block => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
  ...(accessory ? { accessory } : {}),
})

export const sectionFields = (fields: string[]): Block => ({
  type: 'section',
  fields: fields.map((t) => ({ type: 'mrkdwn', text: t })),
})

export const context = (text: string): Block => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text }],
})

export const divider = (): Block => ({ type: 'divider' })

export const button = (
  text: string,
  action_id: string,
  opts: { primary?: boolean; url?: string } = {},
): Block => ({
  type: 'button',
  text: { type: 'plain_text', text, emoji: true },
  action_id,
  ...(opts.primary ? { style: 'primary' } : {}),
  ...(opts.url ? { url: opts.url } : {}),
})

export const actions = (elements: Block[]): Block => ({ type: 'actions', elements })

export const staticSelect = (
  placeholder: string,
  action_id: string,
  options: { text: string; value: string }[],
): Block => ({
  type: 'static_select',
  action_id,
  placeholder: { type: 'plain_text', text: placeholder },
  options: options.map((o) => ({ text: { type: 'plain_text', text: o.text }, value: o.value })),
})

export const plainInput = (block_id: string, label: string, action_id: string): Block => ({
  type: 'input',
  block_id,
  label: { type: 'plain_text', text: label },
  element: { type: 'plain_text_input', action_id },
})
