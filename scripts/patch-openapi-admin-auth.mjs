// One-off: add the admin console sign-in operations (decision 5, assumed
// email + password + authenticator) to docs/api/openapi.yaml. Contract first.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/api/openapi.yaml', import.meta.url);
let s = readFileSync(path, 'utf8');
if (s.includes('/admin/auth/login:')) {
  console.log('already patched');
  process.exit(0);
}

const tagAnchor = `  - name: Admin
    description: Verification queue, reference prices, restricted prices, audit log. Admin role only.
`;
const tagAnchorActual = `  - name: Admin
    description: Verification queue, reference prices, restricted zones, audit log. Admin role only.
`;
const tagAdd = `${tagAnchorActual}  - name: Admin auth
    description: |
      Console sign-in for staff: work email, password, then a 6-digit authenticator code.
      No self-registration; a national admin creates accounts. Five failed attempts lock
      the account for 15 minutes. Sessions are the same bearer tokens as the mobile apps,
      with the admin role in the claims.
`;
if (!s.includes(tagAnchorActual)) {
  console.error('tag anchor not found');
  process.exit(1);
}
void tagAnchor;
// Replacer functions, never replacement strings: the YAML contains "$'" (a regex
// anchor inside a quoted pattern), which String.replace would treat as a special token.
s = s.replace(tagAnchorActual, () => tagAdd);

const pathsAnchor = `  /health:\n`;
const paths = `  # ------------------------------------------------------------------ Admin auth
  /admin/auth/login:
    post:
      tags: [Admin auth]
      operationId: adminLogin
      summary: Step one, email and password
      security: []
      description: |
        Returns a short-lived step token for the authenticator step. The response is the same
        whether the email exists or not, unless the account is locked (423). On the very first
        sign-in the response also carries the authenticator secret to enrol; the first valid
        code confirms it.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string, format: email }
                password: { type: string, minLength: 12, maxLength: 200 }
      responses:
        '200':
          description: Password accepted, authenticator code required.
          content:
            application/json:
              schema:
                type: object
                required: [step_token, expires_in_seconds]
                properties:
                  step_token: { type: string, description: Send with the code within 5 minutes. }
                  expires_in_seconds: { type: integer, example: 300 }
                  totp_setup:
                    type: [object, 'null']
                    description: Present only when no authenticator is enrolled yet.
                    properties:
                      secret: { type: string, description: 'Base32, to type into the app if the QR cannot be scanned.' }
                      otpauth_url: { type: string, format: uri }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '423':
          description: Account locked after repeated failures. Retry-After is set.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /admin/auth/totp:
    post:
      tags: [Admin auth]
      operationId: adminTotp
      summary: Step two, authenticator code
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [step_token, code]
              properties:
                step_token: { type: string }
                code: { type: string, pattern: '^[0-9]{6}$' }
      responses:
        '200':
          description: Signed in.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/TokenPair' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '423':
          description: Account locked after repeated failures.
          content:
            application/problem+json:
              schema: { $ref: '#/components/schemas/Problem' }
  /admin/auth/password:
    post:
      tags: [Admin auth]
      operationId: adminChangePassword
      summary: Change my console password
      description: Requires the admin role and the current password. Revokes every other session.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [current_password, new_password]
              properties:
                current_password: { type: string }
                new_password: { type: string, minLength: 12, maxLength: 200 }
      responses:
        '204': { description: Changed. }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
  # ------------------------------------------------------------------ Ops
${pathsAnchor}`;
if (!s.includes(pathsAnchor)) {
  console.error('paths anchor not found');
  process.exit(1);
}
s = s.replace(pathsAnchor, () => paths);
writeFileSync(path, s);
console.log('openapi.yaml: admin auth operations added');
