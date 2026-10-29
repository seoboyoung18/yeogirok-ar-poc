import { CloudRecord, parseCloudRecord } from './cloudAnchors';

export type TipPhoto = { photoName: string; photoUri: string };
export type LocalTip = {
  schemaVersion: 1;
  id: string;
  title: string;
  body: string;
  createdAt: string;
  cloudRecord: CloudRecord;
  photoName?: string;
  photoUri?: string;
};
export const TIP_BODY_LIMIT = 2000;
export function tipDraftError(
  body: string,
  title: string,
  cloud: CloudRecord | null,
  now = Date.now(),
): string | null {
  if (!body.trim()) {
    return '팁 내용을 적어 주세요.';
  }
  if (body.trim().length > TIP_BODY_LIMIT || title.trim().length > 60) {
    return '제목은 60자, 내용은 2,000자까지 적을 수 있어요.';
  }
  if (!cloud) {
    return 'AR 화면에서 팁을 놓을 위치를 먼저 저장해 주세요.';
  }
  try {
    parseCloudRecord(JSON.stringify(cloud), true, now);
  } catch {
    return 'AR 위치를 새로 저장해 주세요. 앵커 수명은 1일이에요.';
  }
  return null;
}
export function anchorExpired(tip: LocalTip, now = Date.now()): boolean {
  return now >= Date.parse(tip.cloudRecord.expiresAtEstimate);
}
