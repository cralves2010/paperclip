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
  private_metadata?: string
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

/** An option object for selects/overflow (text + value, optional url for overflow). */
const option = (o: { text: string; value: string; url?: string }): Block => ({
  text: { type: 'plain_text', text: o.text, emoji: true },
  value: o.value,
  ...(o.url ? { url: o.url } : {}),
})

export const staticSelect = (
  placeholder: string,
  action_id: string,
  options: { text: string; value: string }[],
  initialValue?: string,
): Block => {
  const opts = options.map((o) => option(o))
  const initial = initialValue !== undefined ? options.find((o) => o.value === initialValue) : undefined
  return {
    type: 'static_select',
    action_id,
    placeholder: { type: 'plain_text', text: placeholder, emoji: true },
    options: opts,
    // Re-published selects must reflect per-user state, not just the placeholder.
    ...(initial ? { initial_option: option(initial) } : {}),
  }
}

/**
 * Overflow menu accessory. `url` (overflow-only) opens client-side; `value` is
 * always present so the interaction still routes to a handler. Slack caps a
 * url at 3000 chars — we never emit longer here (deliverable links are short).
 */
export const overflow = (
  action_id: string,
  options: { text: string; value: string; url?: string }[],
): Block => ({
  type: 'overflow',
  action_id,
  options: options.map((o) => option(o)),
})

export interface PlainInputOpts {
  multiline?: boolean
  maxLength?: number
  optional?: boolean
  placeholder?: string
  initialValue?: string
}

export const plainInput = (
  block_id: string,
  label: string,
  action_id: string,
  opts: PlainInputOpts = {},
): Block => ({
  type: 'input',
  block_id,
  label: { type: 'plain_text', text: label, emoji: true },
  ...(opts.optional ? { optional: true } : {}),
  element: {
    type: 'plain_text_input',
    action_id,
    ...(opts.multiline ? { multiline: true } : {}),
    ...(opts.maxLength ? { max_length: opts.maxLength } : {}),
    ...(opts.placeholder ? { placeholder: { type: 'plain_text', text: opts.placeholder } } : {}),
    ...(opts.initialValue !== undefined ? { initial_value: opts.initialValue } : {}),
  },
})

export interface SelectInputOpts {
  optional?: boolean
  placeholder?: string
  initialValue?: string
}

/** An `input` block wrapping a static_select (collected via view.state.values). */
export const selectInput = (
  block_id: string,
  label: string,
  action_id: string,
  options: { text: string; value: string }[],
  opts: SelectInputOpts = {},
): Block => {
  const initial = opts.initialValue !== undefined ? options.find((o) => o.value === opts.initialValue) : undefined
  return {
    type: 'input',
    block_id,
    label: { type: 'plain_text', text: label, emoji: true },
    ...(opts.optional ? { optional: true } : {}),
    element: {
      type: 'static_select',
      action_id,
      options: options.map((o) => option(o)),
      ...(opts.placeholder ? { placeholder: { type: 'plain_text', text: opts.placeholder } } : {}),
      ...(initial ? { initial_option: option(initial) } : {}),
    },
  }
}
