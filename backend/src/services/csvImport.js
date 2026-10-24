function parseRows(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, line = 1, rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else { cell += char; if (char === '\n') line++; }
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push({ values: row, line: rowLine });
      row = []; cell = ''; line++; rowLine = line;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push({ values: row, line: rowLine });
  return rows;
}

export function previewRosterCsv(input) {
  const rows = parseRows(input);
  if (!rows.length) return { records: [], errors: [] };

  const header = rows[0].values.map((value) => value.trim().toLowerCase());
  const startsWithHeader = header[0] === 'id_key' && header[1] === 'name' && header[2] === 'category';
  const seenIds = new Set();
  const records = [];
  const errors = [];

  for (const { values, line } of rows.slice(startsWithHeader ? 1 : 0)) {
    const [rawId = '', rawName = '', rawCategory = ''] = values;
    const idKey = rawId.trim();
    const name = rawName.trim();
    const category = rawCategory.trim();
    if (values.length !== 3) { errors.push({ line, error: 'Expected exactly three columns: id_key, name, category.' }); continue; }
    if (!idKey || !name || !category) { errors.push({ line, error: 'id_key, name, and category must all be non-empty.' }); continue; }
    if (idKey.length > 160 || name.length > 120 || category.length > 100) { errors.push({ line, error: 'Field too long (id_key 160, name 120, category 100 characters maximum).' }); continue; }
    if (seenIds.has(idKey)) { errors.push({ line, error: `Duplicate id_key “${idKey}” in this file.` }); continue; }
    seenIds.add(idKey);
    records.push({ idKey, name, category, line });
  }
  return { records, errors };
}
