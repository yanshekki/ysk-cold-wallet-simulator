import { LegalBody } from './LegalBody';

const SECTIONS = [
  ['privacy.dataUserTitle', 'privacy.dataUserBody'],
  ['privacy.scopeTitle', 'privacy.scopeBody'],
  ['privacy.noSecretsTitle', 'privacy.noSecretsBody'],
  ['privacy.onDeviceTitle', 'privacy.onDeviceBody'],
  ['privacy.transfersTitle', 'privacy.transfersBody'],
  ['privacy.transborderTitle', 'privacy.transborderBody'],
  ['privacy.purposeTitle', 'privacy.purposeBody'],
  ['privacy.retentionTitle', 'privacy.retentionBody'],
  ['privacy.securityTitle', 'privacy.securityBody'],
  ['privacy.rightsTitle', 'privacy.rightsBody'],
  ['privacy.childrenTitle', 'privacy.childrenBody'],
  ['privacy.changesTitle', 'privacy.changesBody'],
  ['privacy.lawTitle', 'privacy.lawBody'],
] as const;

export function PrivacyBody() {
  return <LegalBody sections={SECTIONS} />;
}
