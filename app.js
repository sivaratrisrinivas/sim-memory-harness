(async () => {
  const R = await (await fetch('results/results.json')).json()
  const $ = (id) => document.getElementById(id)
  const pct = (x) => `${x.k}/${x.n} <small>(${x.pct}%)</small>`
  const LAB = { none: 'None', full_context: 'Full context', window_messages: 'Window: last 10 messages', window_tokens: 'Window: 4,000 tokens' }
  const ORDER = ['none', 'full_context', 'window_messages', 'window_tokens']

  // results table
  $('results').querySelector('thead').innerHTML = '<tr><th>Setting (Sim memory type)</th><th>Dev (72)<br>facts kept</th><th>Held out (48)<br>facts kept</th><th>Request valid<br>dev / held out</th><th>Mean history sent<br>(faked tokens)</th></tr>'
  const best = Math.max(...R.table.filter((t) => t.setting !== 'none').map((t) => t.all.facts_kept.pct))
  $('results').querySelector('tbody').innerHTML = R.table.map((t) => `<tr><td><b>${t.label}</b><br><small>${t.sim}</small></td>
    <td class="num">${pct(t.dev.facts_kept)}</td><td class="num">${pct(t.held_out.facts_kept)}</td>
    <td class="num">${t.dev.request_valid.k}/${t.dev.request_valid.n} · ${t.held_out.request_valid.k}/${t.held_out.request_valid.n}</td>
    <td class="num">${t.dev.mean_history_tokens} dev · ${t.held_out.mean_history_tokens} held out</td></tr>`).join('')

  const dimTable = (id, data, keys, labels = {}) => {
    $(id).innerHTML = '<thead><tr><th></th>' + ORDER.slice(1).map((s) => `<th>${LAB[s].replace('Window: ', '')}</th>`).join('') + '</tr></thead><tbody>' +
      keys.map((k) => `<tr><th>${labels[k] || k}</th>` + ORDER.slice(1).map((s) => { const x = data[s][k]; return `<td class="num ${x.pct >= 90 ? 'best' : x.pct <= 40 ? 'low' : ''}">${x.k}/${x.n}</td>` }).join('') + '</tr>').join('') + '</tbody>'
  }
  dimTable('byshape', R.by_load_shape, ['short_chat', 'chitchat', 'tool_heavy', 'long_paste'], { short_chat: 'short chat', chitchat: 'chit-chat', tool_heavy: 'tool heavy', long_paste: 'long paste' })
  dimTable('bypos', R.by_position, ['next', 'recent', 'inside', 'edge_in', 'edge_out', 'far'], { next: '1 after', recent: '3 after', inside: '7 after', edge_in: '9 after (edge, in)', edge_out: '11 after (edge, out)', far: '19 after' })
  dimTable('bytype', R.by_fact_type, ['id_number', 'constraint', 'preference', 'correction', 'isolation'], { id_number: 'ID and number', constraint: 'constraint', preference: 'preference', correction: 'correction', isolation: 'ID, near-twin neighbor' })

  // timeline
  const TL = R.timeline
  const types = [...new Set(TL.map((t) => t.tuple.fact_type))], shapes = [...new Set(TL.map((t) => t.tuple.load_shape))]
  $('typepick').innerHTML += types.map((t) => `<option>${t}</option>`).join('')
  $('shapepick').innerHTML += shapes.map((t) => `<option>${t}</option>`).join('')
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const filtered = () => TL.filter((t) => ($('splitpick').value === 'all' || t.split === $('splitpick').value) && ($('typepick').value === 'all' || t.tuple.fact_type === $('typepick').value) && ($('shapepick').value === 'all' || t.tuple.load_shape === $('shapepick').value))
  const fillPick = () => {
    const f = filtered(); const cur = $('casepick').value
    $('casepick').innerHTML = f.map((t) => `<option value="${t.id}">${t.id} · ${t.tuple.fact_type} · ${t.tuple.load_shape} · ${t.tuple.distance} after · ${t.split === 'dev' ? 'dev' : 'held out'}</option>`).join('')
    if (f.some((t) => t.id === cur)) $('casepick').value = cur
    draw()
  }
  function draw() {
    const t = TL.find((x) => x.id === $('casepick').value); if (!t) { $('strips').innerHTML = '<p>No case matches.</p>'; return }
    const n = t.messages.length
    $('caseinfo').innerHTML = `<span class="tag">${t.split === 'dev' ? 'dev' : 'held out'}</span><span class="tag">${t.tuple.fact_type}</span><span class="tag">${t.tuple.load_shape}</span><span class="tag">conversation ${esc(t.conversationId)}</span><br>
      <b>Must still be in the request:</b> ${t.must_keep.filter((m) => m.role !== 'stale').map((m) => '<code>' + esc(m.value) + '</code>').join(' ')}
      ${t.must_keep.some((m) => m.role === 'stale') ? '<br><b>Old value (superseded):</b> <code>' + esc(t.must_keep.find((m) => m.role === 'stale').value) + '</code>' : ''}
      <br><b>Probe:</b> “${esc(t.probe)}”`
    $('strips').innerHTML = ORDER.map((s) => {
      const st = t.settings[s]
      const boxes = t.messages.map((m, i) => {
        const fromEnd = n - i // 1 = newest
        const inFinal = fromEnd <= st.kept, inStage1 = fromEnd <= st.stage1
        const cls = ['b', m.role === 'tool' || m.kind === 'tool_call' ? 'tool' : m.role, m.kind === 'fact' || m.kind === 'correction' ? 'fact' : '', inFinal ? '' : inStage1 ? 'dropb' : 'dropw'].join(' ')
        const w = Math.max(5, Math.min(70, 9 + Math.sqrt(m.tokens) * 1.6))
        return `<div class="${cls}" style="width:${w}px" title="#${i + 1} ${m.role}${m.kind !== 'filler' ? ' (' + m.kind + ')' : ''} · ~${m.tokens} tokens (faked)&#10;${esc(m.text)}"></div>`
      }).join('') + '<div class="b probe" title="current user message (probe)"></div>'
      const cause = { by_design_no_memory: 'No memory: history is not sent, by design.', message_count_limit: 'The fact was older than the last 10 messages.', message_count_limit_with_bulk: 'Older than the last 10 messages (this chat also has bulky messages).', token_window_bulk_displacement: 'Bulky tool results or pastes used up the token window first.', token_window_long_history: 'Too many tokens after the fact for the window.', history_budget_16k_stage2: 'The window held it, but the 16,000 token request history budget cut it.' }
      return `<div class="strip"><h3><span>${LAB[s]}</span><span class="verdict ${st.facts_kept ? 'ok' : 'no'}">${st.facts_kept ? 'fact kept' : 'fact lost'}</span></h3>
        <div class="boxes">${boxes}</div>
        <div class="why">${st.kept} of ${n} stored messages sent · about ${st.history_tokens} history tokens (faked count) · ${st.facts_kept ? esc(st.reason) : esc(cause[st.cause] || st.cause) + ' ' + esc(st.reason)}</div></div>`
    }).join('')
  }
  ;['splitpick', 'typepick', 'shapepick'].forEach((id) => $(id).addEventListener('change', fillPick))
  $('casepick').addEventListener('change', draw)
  const q = new URLSearchParams(location.search)
  fillPick()
  // open on a case where the settings disagree: full context keeps the fact, the 10-message window loses it
  const demo = TL.find((t) => t.tuple.load_shape === 'short_chat' && t.settings.full_context.facts_kept && !t.settings.window_messages.facts_kept && t.tuple.fact_type === 'id_number')
  $('casepick').value = q.get('case') || (demo && demo.id); draw()

  // mutants
  $('mutants').querySelector('tbody').innerHTML = R.mutants.map((m) => `<tr><td>${esc(m.what)}</td><td><b>${m.caught ? 'yes' : 'NO'}</b></td><td class="num">${m.regressed_dev_runs} of ${m.of}</td><td>${Object.entries(m.checks_tripped).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}</td></tr>`).join('')
  const miss = R.mutants.filter((m) => !m.caught).map((m) => m.what)
  $('audit').innerHTML = `Caught ${R.mutants.filter((m) => m.caught).length} of ${R.mutants.length}. ${miss.length ? 'Missed: “' + esc(miss.join('; ')) + '”. In these cases the 16,000 token request budget evicts the orphaned tool message before the request is built, so the request looks fine. A real gap in case coverage, kept visible on purpose.' : ''} A second, naive implementation of the facts check (substring over the raw JSON) agrees with the main checker on ${R.checker_audit.naive_agreement.agree} of ${R.checker_audit.naive_agreement.total} runs.`

  // taxonomy
  const causes = Object.keys(R.causes_dev)
  const names = { by_design_no_memory: 'No memory, by design', message_count_limit: 'Older than 10 messages', message_count_limit_with_bulk: 'Older than 10 messages (chat has bulky messages)', token_window_bulk_displacement: 'Bulky results or pastes fill the token window', token_window_long_history: 'Long history fills the token window', history_budget_16k_stage2: 'Cut by the 16,000 token request budget' }
  $('taxonomy').innerHTML = '<thead><tr><th>Cause</th>' + ORDER.map((s) => `<th>${LAB[s].replace('Window: ', '')}</th>`).join('') + '<th>Held out, same cause</th></tr></thead><tbody>' + causes.map((c) => `<tr><th>${names[c] || c}</th>` + ORDER.map((s) => `<td class="num">${R.causes_dev[c][s] || ''}</td>`).join('') + `<td class="num">${Object.values(R.causes_held_out[c] || {}).reduce((a, b) => a + b, 0)}</td></tr>`).join('') + '</tbody>'
})()
