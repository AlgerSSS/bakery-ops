export function parseCsv(text) {
  const input = String(text).replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length !== 0) throw new TypeError("invalid_csv");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new TypeError("invalid_csv");
  if (field.length !== 0 || row.length !== 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length === 0) throw new TypeError("empty_csv");
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new TypeError("duplicate_csv_header");
  return rows.filter((values) => values.some((value) => value !== "")).map((values) => {
    if (values.length !== headers.length) throw new TypeError("csv_width_mismatch");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
