import { actions, button, context, divider, header, section, staticSelect, type Block, type HomeView } from '../blocks.js'
import { STATUS_EMOJI, STATUS_LABEL, type CanonicalStatus, type Task, type ViewState } from '../model.js'
import { rollupCounts } from '../normalize.js'
import { countLine } from '../text.js'

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

  for (const status of GROUP_ORDER) {
    const group = ct.filter((t) => t.status === status)
    if (group.length === 0) continue
    blocks.push(section(`*${STATUS_EMOJI[status]} ${STATUS_LABEL[status]} (${group.length})*`))
    for (const t of group) {
      const updated = t.lastUpdated ? ` · updated ${t.lastUpdated}` : ''
      blocks.push(section(`*${t.title}*\n\`${companyId}-${t.taskNum}\`${updated}`, button('Open', `open_task:${t.taskNum}`)))
    }
  }

  blocks.push(divider(), context('Read-only cockpit (v0) · Actions coming in v1'))
  return { type: 'home', blocks }
}
