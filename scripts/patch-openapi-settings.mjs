// One-off: the settings an admin changes from the console, and the small public
// subset the apps read before anyone signs in.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/admin/settings:')) {
  console.log('already patched');
  process.exit(0);
}
const anchor = '  # ------------------------------------------------------------------ Admin auth\n';
if (!s.includes(anchor)) {
  console.error('anchor not found');
  process.exit(1);
}

const paths = `  /settings:
    get:
      tags: [Ops]
      operationId: getPublicSettings
      summary: Settings the apps may read before anyone signs in
      description: Only the client-facing subset. Pricing settings are never public.
      security: []
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  require_documents:
                    type: boolean
                    description: When false the apps mark document upload as optional and an admin may verify someone without one.
  /admin/settings:
    get:
      tags: [Admin]
      operationId: adminListSettings
      summary: Settings an admin can change without a deploy
      description: Each item carries the label and help text the console shows, so the wording cannot drift from the behaviour.
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
                    items: { $ref: '#/components/schemas/PlatformSetting' }
    patch:
      tags: [Admin]
      operationId: adminSetSetting
      summary: Change one setting
      description: Writes an audit row under the admin who made the change. A commission change applies to deals accepted from then on; deals already struck keep the rate they were agreed at.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [key, value]
              properties:
                key: { type: string, example: commission_percent }
                value:
                  oneOf: [{ type: number }, { type: boolean }, { type: string }]
      responses:
        '200':
          description: Saved. Returns every setting.
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/PlatformSetting' }
        '422': { $ref: '#/components/responses/Unprocessable' }
`;

const schema = `    PlatformSetting:
      type: object
      required: [key, value, type, label, help, set_by_admin]
      properties:
        key: { type: string, example: commission_percent }
        value:
          oneOf: [{ type: number }, { type: boolean }]
        type: { type: string, enum: [number, boolean] }
        label: { type: string, description: Short name shown in the console. }
        help: { type: string, description: 'What the setting does, written for the admin reading it.' }
        set_by_admin: { type: boolean, description: 'False while the value is still the one the server started with.' }
        updated_by_name: { type: [string, 'null'] }
        updated_at: { type: [string, 'null'], format: date-time }
`;

s = s.replace(anchor, () => paths + anchor);
s = s.trimEnd() + '\n' + schema;
writeFileSync(path, s);
console.log('openapi.yaml: settings endpoints and PlatformSetting');
