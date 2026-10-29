import { CloudRecord } from '../cloudAnchors';
import { anchorExpired, LocalTip, tipDraftError } from '../localTips';

const cloud: CloudRecord = {
  schemaVersion: 1,
  kind: 'yeogirok-cloud-anchor',
  recordId: 'test',
  anchorType: 'CLOUD',
  anchorId: 'test-anchor',
  ttlDays: 1,
  hostedAt: '2026-10-29T10:00:00Z',
  expiresAtEstimate: '2026-10-30T10:00:00Z',
  hostSessionId: 'test-session',
  hostDeviceLabel: 'test-device',
  featureMapQuality: 'GOOD',
  qualityPolicy: 'GOOD_STABLE',
  hitType: 'PLANE',
  depthEnabled: true,
  depthHitAllowed: false,
  geospatial: null,
  crossDeviceVerified: false,
  localPose: {
    frame: 'native-arcore-session',
    positionMeters: [1, 2, 3],
    rotationQuaternionXYZW: [0, 0, 0, 1],
  },
  operation: {
    type: 'HOST',
    sessionId: 'test-session',
    deviceLabel: 'test-device',
    recordedAt: '2026-10-29T10:00:05Z',
    durationMs: 5000,
  },
};
const now = Date.parse('2026-10-29T12:00:00Z');

test('text-only tip accepts a valid anchor without a photo, title or map coordinate', () => {
  expect(tipDraftError('창가에 햇살이 좋아요.', '', cloud, now)).toBeNull();
  expect(cloud.discoveryLocation).toBeUndefined();
});
test('empty text and missing AR placement are separately rejected', () => {
  expect(tipDraftError(' \n ', '제목만', cloud, now)).toContain('내용');
  expect(tipDraftError('내용', '', null, now)).toContain('위치');
});
test('content length boundaries retain Korean text', () => {
  expect(
    tipDraftError('가'.repeat(2000), '가'.repeat(60), cloud, now),
  ).toBeNull();
  expect(tipDraftError('가'.repeat(2001), '', cloud, now)).not.toBeNull();
  expect(tipDraftError('내용', '가'.repeat(61), cloud, now)).not.toBeNull();
});
test('expiration blocks a new attachment at the exact boundary', () => {
  const expiry = Date.parse(cloud.expiresAtEstimate);
  expect(tipDraftError('내용', '', cloud, expiry - 1)).toBeNull();
  expect(tipDraftError('내용', '', cloud, expiry)).toContain('수명');
});
test('expired local content remains readable without misrepresenting AR availability', () => {
  const tip: LocalTip = {
    schemaVersion: 1,
    id: 'test',
    title: '제목',
    body: '보관할 글',
    createdAt: cloud.hostedAt,
    cloudRecord: cloud,
    photoName: 'test.jpg',
    photoUri: 'file:///private/test.jpg',
  };
  expect(anchorExpired(tip, now)).toBe(false);
  expect(anchorExpired(tip, Date.parse(cloud.expiresAtEstimate))).toBe(true);
  expect(tip.body).toBe('보관할 글');
  expect(tip.photoUri).toBe('file:///private/test.jpg');
});
test('invalid anchor cannot be saved and author text is not inserted into shareable Cloud data', () => {
  expect(
    tipDraftError('내용', '', { ...cloud, anchorId: '' }, now),
  ).not.toBeNull();
  tipDraftError('개인 글', '제목', cloud, now);
  expect(JSON.stringify(cloud)).not.toContain('개인 글');
});
