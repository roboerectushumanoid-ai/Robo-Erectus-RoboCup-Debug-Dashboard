function toggleExamples() {
  const panel = document.getElementById('examples-panel');
  const btn = document.getElementById('examples-toggle');
  panel.classList.toggle('open');
  btn.classList.toggle('active', panel.classList.contains('open'));
}

async function requestJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function renderExamples(data) {
  const select = document.getElementById('examples-select');
  const status = document.getElementById('examples-status');
  const runBtn = document.getElementById('examples-run');
  const stopBtn = document.getElementById('examples-stop');
  const log = document.getElementById('examples-log');

  const selected = select.value;
  select.replaceChildren(...(data.examples ?? []).map(example => {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.label;
    option.selected = example.id === selected;
    return option;
  }));

  const selectedExample = (data.examples ?? []).find(example => example.id === select.value) ?? data.examples?.[0];
  if (selectedExample) select.value = selectedExample.id;

  status.textContent = data.running
    ? `Running: ${data.running.label}`
    : (selectedExample?.description ?? 'No examples available');
  runBtn.disabled = Boolean(data.running) || !selectedExample;
  stopBtn.disabled = !data.running;
  log.textContent = (data.log ?? []).join('\n') || 'No example output yet.';
  log.scrollTop = log.scrollHeight;
}

async function refreshExamples() {
  try {
    renderExamples(await requestJson('/api/examples'));
  } catch (err) {
    document.getElementById('examples-status').textContent = err.message;
  }
}

async function runSelectedExample() {
  const select = document.getElementById('examples-select');
  try {
    renderExamples(await requestJson('/api/examples/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: select.value }),
    }));
  } catch (err) {
    document.getElementById('examples-status').textContent = err.message;
    refreshExamples();
  }
}

async function stopExample() {
  try {
    renderExamples(await requestJson('/api/examples/stop', { method: 'POST' }));
  } catch (err) {
    document.getElementById('examples-status').textContent = err.message;
  }
}

export function setupExamples() {
  document.getElementById('examples-toggle').addEventListener('click', toggleExamples);
  document.getElementById('examples-run').addEventListener('click', runSelectedExample);
  document.getElementById('examples-stop').addEventListener('click', stopExample);
  document.getElementById('examples-select').addEventListener('change', refreshExamples);
  refreshExamples();
  setInterval(refreshExamples, 1500);
}
