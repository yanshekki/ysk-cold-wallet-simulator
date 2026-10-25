import { LegalBody } from './LegalBody';

const SECTIONS = [
  ['disclaimer.partiesTitle', 'disclaimer.partiesBody'],
  ['disclaimer.definitionsTitle', 'disclaimer.definitionsBody'],
  ['disclaimer.licenceTitle', 'disclaimer.licenceBody'],
  ['disclaimer.natureTitle', 'disclaimer.natureBody'],
  ['disclaimer.notRegulatedTitle', 'disclaimer.notRegulatedBody'],
  ['disclaimer.prohibitedTitle', 'disclaimer.prohibitedBody'],
  ['disclaimer.secretsTitle', 'disclaimer.secretsBody'],
  ['disclaimer.warrantyTitle', 'disclaimer.warrantyBody'],
  ['disclaimer.liabilityTitle', 'disclaimer.liabilityBody'],
  ['disclaimer.indemnityTitle', 'disclaimer.indemnityBody'],
  ['disclaimer.thirdTitle', 'disclaimer.thirdBody'],
  ['disclaimer.generalTitle', 'disclaimer.generalBody'],
  ['disclaimer.lawTitle', 'disclaimer.lawBody'],
] as const;

export function DisclaimerBody() {
  return <LegalBody sections={SECTIONS} />;
}
