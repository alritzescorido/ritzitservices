// One-off: admin-wide deals list for the console (Disputes and Deals screens).
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/admin/deals:')) {
  console.log('already patched');
  process.exit(0);
}
const anchor = `  /admin/deals/{deal_id}/outlier-review:\n`;
if (!s.includes(anchor)) {
  console.error('anchor not found');
  process.exit(1);
}
const add = `  /admin/deals:
    get:
      tags: [Admin]
      operationId: adminListDeals
      summary: Deals across all users, newest first
      parameters:
        - name: state
          in: query
          schema: { $ref: '#/components/schemas/DealState' }
        - name: species
          in: query
          schema: { $ref: '#/components/schemas/Species' }
        - name: province_code
          in: query
          schema: { $ref: '#/components/schemas/PsgcCode' }
        - name: outliers_only
          in: query
          schema: { type: boolean, default: false }
        - $ref: '#/components/parameters/Cursor'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [items]
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/Deal' }
                  next_cursor: { type: [string, 'null'] }
${anchor}`;
s = s.replace(anchor, () => add);
writeFileSync(path, s);
console.log('openapi.yaml: /admin/deals added');
