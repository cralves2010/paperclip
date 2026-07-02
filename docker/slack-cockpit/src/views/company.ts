import { actions, button, context, divider, header, section, staticSelect, type Block, type HomeView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, type CanonicalStatus, type Task, type ViewState } from '../model.js'
import { rollupCounts } from '../normalize.js'
import { clamp, countLine } from '../text.js'

// Defensive cap so a large company can never blow the 100-block App Home limit.
const MAX_ROWS = 80

const GROUP_ORDER: CanonicalStatus[] = [
  'needs_you',
  'delivered_awaiting',
  'changes_requested',
  'in_progress',
  'blocked',
  'queued',
  'done',
]

export function buildCompanyView(tasks: Task[], companyId: string, _state: ViewState): HomeView {
  const ct = tasks.filter((t) => t.company === companyId)
  const blocks: Block[] = [
    header(`${companyId} · Tasks`),
    actions([
      button('← Portfolio', 'back_to_home'),
      staticSelect('Status: All', 'filter_status', [
        { text: 'All', value: 'all' },
        { text: 'Open (hide Done)', value: 'open' },
        ...GROUP_ORDER.map((s) => ({ text: STATUS_LABEL[s], value: s })),
      ]),
    ]),
    context(countLine(rollupCounts(ct))),
    divider(),
  ]

  let rendered = 0
  for (const status of GROUP_ORDER) {
    const group = ct.filter((t) => t.status === status)
    if (group.length === 0) continue
    blocks.push(section(`*${STATUS_EMOJI[status]} ${STATUS_LABEL[status]} (${group.length})*`))
    for (const t of group) {
      if (rendered >= MAX_ROWS) break
      const updated = t.lastUpdated ? ` · updated ${t.lastUpdated}` : ''
      blocks.push(section(`*${clamp(t.title, 200)}*\n\`${companyId}-${t.taskNum}\`${updated}`, button('Open', `open_task:${t.taskNum}`)))
      rendered++
    }
    if (rendered >= MAX_ROWS) break
  }
  if (rendered < ct.length) blocks.push(context(`Showing ${rendered} of ${ct.length} tasks`))

  blocks.push(divider(), context('Read-only cockpit (v0) · Actions coming in v1'))
  return { type: 'home', blocks }
}
