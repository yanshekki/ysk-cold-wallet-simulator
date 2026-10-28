import { signingHoldLabel } from '@cws/contracts';
import { SigningModal } from '@cws/ui';
import { useT } from '../i18n';
import { useAppState } from '../state/AppState';

type Props = {
  /** Inside the QR sheet modal. iOS will not present a second Modal over that sheet. */
  embedded?: boolean;
};

export function HostedSigningModal({ embedded = false }: Props) {
  const t = useT();
  const {
    pending,
    resolveSigning,
    settings,
    sessionPassphraseApplied,
    passphraseFingerprint,
    signingHosted,
  } = useAppState();
  const visible = embedded ? !!pending : !!pending && !signingHosted;

  return (
    <SigningModal
      embedded={embedded}
      visible={visible}
      request={pending}
      onConfirm={() => resolveSigning(true)}
      onReject={() => resolveSigning(false)}
      holdLabel={t(signingHoldLabel(pending?.kind ?? 'sign'))}
      holdDurationSeconds={settings.holdDurationSeconds}
      rejectLabel={t('signing.reject')}
      confirmTitle={t('signing.title')}
      verifyingLabel={t('signing.verifying')}
      sessionPassphraseApplied={sessionPassphraseApplied}
      passphraseAppliedLabel={
        passphraseFingerprint
          ? t('signing.fingerprint', { hex: passphraseFingerprint })
          : t('signing.applied')
      }
      passphraseIdleLabel={t('signing.idle')}
      passphraseHostLabel={t('signing.hostPassphrase')}
      copy={{
        decodeFailed: t('signing.decodeFailed'),
        personalMessage: t('signing.personalMessage'),
        rawMessage: t('signing.rawMessage'),
        noticeOpenApp: t('signing.noticeOpenApp'),
        noticeManager: t('signing.noticeManager'),
        noticePairing: t('signing.noticePairing'),
        noticeVerify: t('signing.noticeVerify'),
        payload: t('signing.payload'),
        purposeSign: t('signing.purposeSign'),
        purposeAddress: t('signing.purposeAddress'),
        purposeVerify: t('signing.purposeVerify'),
        purposeOpenApp: t('signing.purposeOpenApp'),
        purposeManager: t('signing.purposeManager'),
        purposePairing: t('signing.purposePairing'),
        purposeExportSeed: t('signing.purposeExportSeed'),
        headlineBtcTx: t('signing.headlineBtcTx'),
        headlineEthTx: t('signing.headlineEthTx'),
        headlineTokenTransfer: t('signing.headlineTokenTransfer'),
        headlineTokenApprove: t('signing.headlineTokenApprove'),
        headlineEip712: t('signing.headlineEip712'),
        headlineEip7702: t('signing.headlineEip7702'),
        notice7702: t('signing.notice7702'),
        fieldLabels: {
          CHAIN: t('signing.field.chain'),
          'CHAIN ID': t('signing.field.chainId'),
          PATH: t('signing.field.path'),
          TO: t('signing.field.to'),
          VALUE: t('signing.field.value'),
          FEE: t('signing.field.fee'),
          WEI: t('signing.field.wei'),
          NONCE: t('signing.field.nonce'),
          GAS: t('signing.field.gas'),
          'GAS PRICE': t('signing.field.gasPrice'),
          'MAX FEE': t('signing.field.maxFee'),
          'MAX PRIORITY': t('signing.field.maxPriority'),
          'ACCESS LIST': t('signing.field.accessList'),
          'BLOB FEE': t('signing.field.blobFee'),
          BLOBS: t('signing.field.blobs'),
          AUTHORIZATIONS: t('signing.field.authorizations'),
          SELECTOR: t('signing.field.selector'),
          DATA: t('signing.field.data'),
          METHOD: t('signing.field.method'),
          CONTRACT: t('signing.field.contract'),
          'AMOUNT RAW': t('signing.field.amountRaw'),
          AMOUNT: t('signing.field.amount'),
          TICKER: t('signing.field.ticker'),
          TYPE: t('signing.field.type'),
          DOMAIN: t('signing.field.domain'),
          MESSAGE: t('signing.field.message'),
          HASH: t('signing.field.hash'),
          BYTES: t('signing.field.bytes'),
          PAYLOAD: t('signing.field.payload'),
          SPENDER: t('signing.field.spender'),
        },
      }}
    />
  );
}
