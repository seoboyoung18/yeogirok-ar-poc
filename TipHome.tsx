import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CloudRecord, parseCloudRecord } from './cloudAnchors';
import {
  anchorExpired,
  LocalTip,
  TipPhoto,
  tipDraftError,
  TIP_BODY_LIMIT,
} from './localTips';

type TipBridge = {
  listTips(): Promise<string>;
  saveTip(raw: string): Promise<string>;
  pickPhoto(): Promise<string | null>;
  openTipAR(id: string): Promise<void>;
};
type GeoBridge = {
  getLastCloudRecord(): Promise<string | null>;
  openTipPlacement(): Promise<string | null>;
  openCloudMap(raw: string): Promise<string | null>;
};
const tipBridge = NativeModules.TipExperience as TipBridge | undefined;
const geoBridge = NativeModules.GeoValidation as GeoBridge | undefined;
type Page = 'home' | 'library' | 'compose' | 'detail';

function Action({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        secondary && s.secondary,
        (disabled || pressed) && s.dim,
      ]}
    >
      <Text style={[s.actionText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

function Photo({ uri, compact = false }: { uri: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return failed ? (
    <View style={s.photoMissing}>
      <Text style={s.muted}>사진을 불러오지 못했어요.</Text>
    </View>
  ) : (
    <Image
      source={{ uri }}
      accessibilityLabel="팁에 첨부한 사진"
      resizeMode={compact ? 'cover' : 'contain'}
      onError={() => setFailed(true)}
      style={compact ? s.thumbnail : s.photo}
    />
  );
}

export default function TipHome({ onLab }: { onLab: () => void }) {
  const [page, setPage] = useState<Page>('home');
  const [tips, setTips] = useState<LocalTip[]>([]);
  const [selected, setSelected] = useState<LocalTip | null>(null);
  const [lastCloud, setLastCloud] = useState<CloudRecord | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<TipPhoto | null>(null);
  const [cloud, setCloud] = useState<CloudRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [page]);
  useEffect(() => {
    if (notice) {
      scroll.current?.scrollTo({ y: 0, animated: true });
    }
  }, [notice]);

  const load = useCallback(async () => {
    if (!tipBridge || !geoBridge) {
      setNotice(
        '새 홈 기능을 사용하려면 Android 앱을 다시 빌드해 설치해 주세요.',
      );
      setLoading(false);
      return;
    }
    try {
      const [stored, last] = await Promise.all([
        tipBridge.listTips(),
        geoBridge.getLastCloudRecord(),
      ]);
      setTips(JSON.parse(stored) as LocalTip[]);
      setLastCloud(last ? parseCloudRecord(last) : null);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '저장한 팁을 불러오지 못했어요.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        load();
      }
    });
    return () => sub.remove();
  }, [load]);

  function clearDraft() {
    setTitle('');
    setBody('');
    setPhoto(null);
    setCloud(null);
  }
  const goBack = useCallback(() => {
    if (busy) {
      return;
    }
    if (page === 'compose' && (title || body || photo || cloud)) {
      Alert.alert(
        '작성을 그만둘까요?',
        '저장하지 않은 글과 사진 선택이 사라져요.',
        [
          { text: '계속 작성', style: 'cancel' },
          {
            text: '그만두기',
            style: 'destructive',
            onPress: () => {
              clearDraft();
              setPage('home');
            },
          },
        ],
      );
    } else {
      setPage('home');
      setNotice('');
    }
  }, [page, busy, title, body, photo, cloud]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'home' && !busy) {
        return false;
      }
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [page, busy, goBack]);

  async function run(work: () => Promise<void>) {
    if (lock.current) {
      return;
    }
    if (!tipBridge || !geoBridge) {
      setNotice('앱을 다시 빌드해 설치한 뒤 이용해 주세요.');
      return;
    }
    lock.current = true;
    Keyboard.dismiss();
    setBusy(true);
    setNotice('');
    try {
      await work();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '완료하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function compose() {
    clearDraft();
    setNotice('');
    setPage('compose');
  }
  function detail(tip: LocalTip) {
    setSelected(tip);
    setPage('detail');
    setNotice('');
  }
  function openAR(tip: LocalTip) {
    run(async () => {
      await tipBridge!.openTipAR(tip.id);
    });
  }
  function place() {
    run(async () => {
      const raw = await geoBridge!.openTipPlacement();
      if (raw) {
        setCloud(parseCloudRecord(raw));
        setNotice(
          'AR 위치를 저장했어요. 글과 사진을 확인한 뒤 팁 저장을 눌러 주세요.',
        );
      }
    });
  }
  function pickPhoto() {
    run(async () => {
      const raw = await tipBridge!.pickPhoto();
      if (raw) {
        setPhoto(JSON.parse(raw) as TipPhoto);
      }
    });
  }
  function map() {
    if (!cloud) {
      return;
    }
    run(async () => {
      const raw = await geoBridge!.openCloudMap(JSON.stringify(cloud));
      if (raw) {
        setCloud(parseCloudRecord(raw));
      }
    });
  }
  function save() {
    const error = tipDraftError(body, title, cloud);
    if (error) {
      setNotice(error);
      return;
    }
    run(async () => {
      const tip = JSON.parse(
        await tipBridge!.saveTip(
          JSON.stringify({
            title,
            body,
            photoName: photo?.photoName,
            cloudRecord: cloud,
          }),
        ),
      ) as LocalTip;
      setTips(old => [tip, ...old.filter(item => item.id !== tip.id)]);
      setSelected(tip);
      clearDraft();
      setPage('detail');
      setNotice('내 기기에 팁을 저장했어요. AR로 찾아 핀을 눌러 보세요.');
    });
  }

  const disabled = busy || loading;
  const header =
    page === 'compose'
      ? '팁 남기기'
      : page === 'detail'
      ? '내 팁'
      : page === 'library'
      ? '저장한 팁 찾기'
      : '여기록';
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#FAF8F3" />
        <View style={s.header}>
          {page === 'home' ? (
            <View style={s.logo}>
              <Text style={s.logoText}>여</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="홈으로"
              onPress={goBack}
              disabled={busy}
              style={s.back}
            >
              <Text style={s.backText}>‹</Text>
            </Pressable>
          )}
          <Text style={s.brand}>{header}</Text>
          <View style={s.badge}>
            <Text style={s.badgeText}>내 기기 체험</Text>
          </View>
        </View>
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scroll}
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {notice ? (
              <View accessibilityLiveRegion="polite" style={s.notice}>
                <Text style={s.noticeText}>{notice}</Text>
              </View>
            ) : null}
            {(busy || loading) && (
              <View style={s.working}>
                <ActivityIndicator color="#D9502A" />
                <Text style={s.muted}>
                  {busy ? '처리하고 있어요…' : '저장한 팁을 가져오고 있어요…'}
                </Text>
              </View>
            )}
            {page === 'home' && (
              <>
                <View style={s.hero}>
                  <Text style={s.eyebrow}>장소에 남기는 작은 발견</Text>
                  <Text style={s.heroTitle}>
                    {'여기,\n기억해 둘 이야기가 있어요.'}
                  </Text>
                  <Text style={s.heroBody}>
                    공간에 팁을 남기고, 카메라로 다시 만나 보세요.
                  </Text>
                  <View style={s.heroMark}>
                    <Text style={s.heroMarkText}>여기!</Text>
                    <View style={s.heroDot} />
                  </View>
                  <Action
                    label="+  이곳에 팁 남기기"
                    onPress={compose}
                    disabled={disabled}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  style={s.findCard}
                  onPress={() => {
                    setNotice('');
                    setPage('library');
                  }}
                >
                  <View style={s.findIcon}>
                    <Text style={s.findIconText}>↗</Text>
                  </View>
                  <View style={s.flex}>
                    <Text style={s.cardTitle}>AR로 팁 찾기</Text>
                    <Text style={s.muted}>
                      내가 저장한 장소에서 핀을 찾아보세요
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <View style={s.row}>
                  <Text style={s.section}>내가 남긴 팁</Text>
                  <Text style={s.count}>{tips.length}개</Text>
                </View>
                {!loading && tips.length === 0 && (
                  <View style={s.empty}>
                    <Text style={s.emptyTitle}>첫 번째 팁을 남겨 보세요</Text>
                    <Text style={s.muted}>
                      글만 남겨도 좋아요. 사진은 선택이에요.
                    </Text>
                  </View>
                )}
                {tips.slice(0, 3).map(tip => (
                  <TipCard
                    key={tip.id}
                    tip={tip}
                    onPress={() => detail(tip)}
                    disabled={disabled}
                  />
                ))}
                {tips.length > 3 && (
                  <Action
                    secondary
                    label="내 팁 모두 보기"
                    onPress={() => setPage('library')}
                    disabled={disabled}
                  />
                )}
                <Text style={s.footnote}>
                  {
                    '지금은 내 기기에 저장한 팁으로 체험해요.\n앱을 삭제하거나 데이터를 지우면 글과 사진도 지워져요.'
                  }
                </Text>
              </>
            )}
            {page === 'library' && (
              <>
                <Text style={s.pageTitle}>
                  {'남겨 둔 장소로\n다시 가볼까요?'}
                </Text>
                <Text style={s.muted}>
                  {
                    '팁을 선택하고 ‘AR로 찾기’를 눌러 주세요.\n지도 위치가 있는 팁은 미니맵으로 안내해요.'
                  }
                </Text>
                {!loading && tips.length === 0 && (
                  <View style={s.empty}>
                    <Text style={s.emptyTitle}>아직 저장한 팁이 없어요</Text>
                    <Action
                      label="첫 팁 남기기"
                      onPress={compose}
                      disabled={disabled}
                    />
                  </View>
                )}
                {tips.map(tip => (
                  <TipCard
                    key={tip.id}
                    tip={tip}
                    onPress={() => detail(tip)}
                    disabled={disabled}
                  />
                ))}
              </>
            )}
            {page === 'compose' && (
              <>
                <Text style={s.pageTitle}>
                  {'이 장소의 이야기를\n남겨 주세요.'}
                </Text>
                <Text style={s.label}>
                  제목 <Text style={s.optional}>선택</Text>
                </Text>
                <TextInput
                  style={s.input}
                  placeholder="예: 오후 햇살이 좋은 자리"
                  placeholderTextColor="#97988C"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={60}
                  editable={!busy}
                  accessibilityLabel="팁 제목"
                />
                <View style={s.row}>
                  <Text style={s.label}>
                    팁 내용 <Text style={s.required}>필수</Text>
                  </Text>
                  <Text style={s.counter}>
                    {body.length} / {TIP_BODY_LIMIT}
                  </Text>
                </View>
                <TextInput
                  style={[s.input, s.bodyInput]}
                  multiline
                  textAlignVertical="top"
                  placeholder="다음에 이곳을 찾을 사람에게 알려주고 싶은 내용을 적어 주세요."
                  placeholderTextColor="#97988C"
                  value={body}
                  onChangeText={setBody}
                  maxLength={TIP_BODY_LIMIT}
                  editable={!busy}
                  accessibilityLabel="팁 내용"
                />
                <Text style={s.label}>
                  사진 한 장 <Text style={s.optional}>선택</Text>
                </Text>
                {photo ? (
                  <>
                    <Photo uri={photo.photoUri} />
                    <View style={s.row}>
                      <View style={s.flex}>
                        <Action
                          secondary
                          label="사진 바꾸기"
                          onPress={pickPhoto}
                          disabled={busy}
                        />
                      </View>
                      <View style={s.flex}>
                        <Action
                          secondary
                          label="사진 빼기"
                          onPress={() => setPhoto(null)}
                          disabled={busy}
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="사진 추가"
                    style={s.photoPicker}
                    onPress={pickPhoto}
                    disabled={busy}
                  >
                    <Text style={s.photoPlus}>＋</Text>
                    <Text style={s.cardTitle}>장소를 더 잘 보여주는 사진</Text>
                    <Text style={s.muted}>앨범에서 한 장 선택 · 최대 20MB</Text>
                  </Pressable>
                )}
                <View style={s.locationCard}>
                  <Text style={s.cardTitle}>
                    {cloud
                      ? '✓ AR 위치를 저장했어요'
                      : '팁을 놓을 위치를 골라 주세요'}
                  </Text>
                  <Text style={s.muted}>
                    카메라에서 터치로 배치하고, 핀을 끌어 조정해요.
                  </Text>
                  <Action
                    secondary
                    label={
                      cloud ? 'AR 위치 다시 배치' : '카메라에서 위치 정하기'
                    }
                    onPress={place}
                    disabled={busy}
                  />
                  {!cloud &&
                    lastCloud &&
                    Date.now() < Date.parse(lastCloud.expiresAtEstimate) && (
                      <Action
                        secondary
                        label="최근 실험에서 저장한 위치 사용"
                        disabled={busy}
                        onPress={() => {
                          setCloud(lastCloud);
                          setNotice(
                            '최근 Cloud 앵커를 연결했어요. 같은 장소인지 확인해 주세요.',
                          );
                        }}
                      />
                    )}
                  {cloud && (
                    <>
                      <Action
                        secondary
                        label={
                          cloud.discoveryLocation
                            ? '✓ 지도 위치 변경'
                            : '지도에도 탐색 위치 표시하기'
                        }
                        onPress={map}
                        disabled={busy}
                      />
                      <Text style={s.footnote}>
                        지도에서 직접 고른 탐색 위치예요. 정확한 공간 복원에는
                        AR 앵커를 사용해요.
                      </Text>
                    </>
                  )}
                </View>
                <Text style={s.footnote}>
                  {
                    '이 체험의 AR 앵커는 1일간 유효해요.\n팁의 글과 사진은 만료 후에도 내 기기에 남아요.'
                  }
                </Text>
                <Action
                  label="내 기기에 팁 저장"
                  onPress={save}
                  disabled={busy}
                />
              </>
            )}
            {page === 'detail' && selected && (
              <>
                <Text style={s.eyebrow}>
                  내가 남긴 팁 ·{' '}
                  {new Date(selected.createdAt).toLocaleDateString('ko-KR')}
                </Text>
                <Text style={s.pageTitle}>{selected.title}</Text>
                {selected.photoUri ? (
                  <Photo uri={selected.photoUri} />
                ) : selected.photoName ? (
                  <Text style={s.muted}>사진 파일을 찾을 수 없어요.</Text>
                ) : null}
                <Text selectable style={s.detailBody}>
                  {selected.body}
                </Text>
                <View style={s.locationCard}>
                  <Text style={s.cardTitle}>
                    {anchorExpired(selected)
                      ? 'AR 앵커가 만료됐어요'
                      : '이 장소에서 다시 만나기'}
                  </Text>
                  <Text style={s.muted}>
                    {anchorExpired(selected)
                      ? '글과 사진은 그대로예요. AR 탐색을 시험하려면 새 팁을 배치해 주세요.'
                      : selected.cloudRecord.discoveryLocation
                      ? '미니맵과 방향 안내를 따라가세요. 복원된 주황 핀을 누르면 글과 사진을 볼 수 있어요.'
                      : '팁을 저장한 장소에서 주변을 비춰 주세요. 복원된 주황 핀을 누르면 상세 내용이 열려요.'}
                  </Text>
                  <Action
                    label={
                      anchorExpired(selected) ? '새 팁 남기기' : 'AR로 찾기  ↗'
                    }
                    onPress={() =>
                      anchorExpired(selected) ? compose() : openAR(selected)
                    }
                    disabled={busy}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
        {page !== 'compose' && (
          <View style={s.nav}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPage('home');
                setNotice('');
              }}
              disabled={busy}
              style={s.navItem}
            >
              <Text style={[s.navText, page === 'home' && s.navActive]}>
                홈
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPage('library');
                setNotice('');
              }}
              disabled={busy}
              style={s.navItem}
            >
              <Text style={[s.navText, page === 'library' && s.navActive]}>
                내 팁
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onLab}
              disabled={busy}
              style={s.navItem}
            >
              <Text style={s.navText}>AR 실험실</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function TipCard({
  tip,
  onPress,
  disabled,
}: {
  tip: LocalTip;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tip.title + ', 상세 보기'}
      onPress={onPress}
      disabled={disabled}
      style={s.tipCard}
    >
      {tip.photoUri ? (
        <Photo uri={tip.photoUri} compact />
      ) : (
        <View style={s.textThumbnail}>
          <Text style={s.textThumbnailText}>여기록</Text>
        </View>
      )}
      <View style={s.flex}>
        <Text style={s.tipTag}>
          {anchorExpired(tip)
            ? '글·사진 보관 중'
            : tip.cloudRecord.discoveryLocation
            ? '미니맵 · AR 탐색'
            : '현장에서 AR 탐색'}
        </Text>
        <Text numberOfLines={2} style={s.cardTitle}>
          {tip.title}
        </Text>
        <Text numberOfLines={1} style={s.muted}>
          {tip.body}
        </Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#FAF8F3' },
  header: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 34,
    height: 38,
    borderRadius: 13,
    borderBottomRightRadius: 4,
    backgroundColor: '#D9502A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#FFF', fontWeight: '800', fontSize: 21 },
  brand: {
    flex: 1,
    fontSize: 23,
    fontWeight: '800',
    color: '#30362E',
    letterSpacing: -1,
  },
  badge: {
    backgroundColor: '#ECEDE3',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  badgeText: { color: '#636B59', fontSize: 11, fontWeight: '600' },
  back: {
    width: 36,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backText: { fontSize: 38, lineHeight: 40, color: '#30362E' },
  content: { padding: 22, paddingTop: 8, paddingBottom: 36, gap: 16 },
  hero: {
    backgroundColor: '#F0EBDF',
    borderRadius: 26,
    padding: 24,
    gap: 15,
    overflow: 'hidden',
  },
  eyebrow: {
    color: '#88633E',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroTitle: {
    fontSize: 28,
    lineHeight: 38,
    letterSpacing: -1.3,
    fontWeight: '800',
    color: '#30362E',
  },
  heroBody: { fontSize: 14, lineHeight: 23, color: '#69715E', maxWidth: 240 },
  heroMark: {
    width: 86,
    height: 94,
    backgroundColor: '#D9502A',
    borderRadius: 40,
    borderBottomLeftRadius: 8,
    alignSelf: 'flex-end',
    marginVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '10deg' }],
  },
  heroMarkText: { color: '#FFF5E8', fontSize: 23, fontWeight: '800' },
  heroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFF5E8',
    marginTop: 7,
  },
  action: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#D9502A',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: '#F4EFE7',
    borderWidth: 1,
    borderColor: '#DDD7CB',
  },
  secondaryText: { color: '#444C3E' },
  dim: { opacity: 0.45 },
  findCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E9E6DD',
  },
  findIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: '#EEF1E6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  findIconText: { fontSize: 29, color: '#66744E' },
  cardTitle: {
    color: '#30362E',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    marginBottom: 4,
  },
  muted: { color: '#74796C', fontSize: 13, lineHeight: 21 },
  chevron: { color: '#949A89', fontSize: 28 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  section: { fontSize: 19, fontWeight: '700', color: '#30362E', marginTop: 8 },
  count: { fontSize: 13, color: '#7E846F' },
  empty: { padding: 24, borderRadius: 20, backgroundColor: '#F0EFE8', gap: 10 },
  emptyTitle: { fontSize: 16, color: '#535D48', fontWeight: '600' },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E6E3D9',
  },
  thumbnail: {
    width: 78,
    height: 86,
    borderRadius: 16,
    backgroundColor: '#EEE',
  },
  textThumbnail: {
    width: 78,
    height: 86,
    borderRadius: 16,
    backgroundColor: '#E8ECDE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textThumbnailText: { color: '#778461', fontSize: 14, fontWeight: '700' },
  tipTag: {
    color: '#B45A36',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 5,
  },
  footnote: { fontSize: 12, lineHeight: 20, color: '#858879' },
  nav: {
    flexDirection: 'row',
    backgroundColor: '#FAF8F3',
    borderTopWidth: 1,
    borderColor: '#E8E4D9',
    paddingVertical: 6,
  },
  navItem: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { fontSize: 13, fontWeight: '600', color: '#8A8F80' },
  navActive: { color: '#D9502A' },
  pageTitle: {
    color: '#30362E',
    fontSize: 28,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -1,
  },
  label: { fontSize: 15, fontWeight: '700', color: '#414A37', marginTop: 8 },
  optional: { fontSize: 11, fontWeight: '400', color: '#8A8F80' },
  required: { fontSize: 11, color: '#C95934' },
  counter: { fontSize: 11, color: '#8A8F80' },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DEDCD2',
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: '#30362E',
    minHeight: 54,
  },
  bodyInput: { minHeight: 150, lineHeight: 24 },
  photoPicker: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C9CCBE',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#F3F3EC',
  },
  photoPlus: { fontSize: 31, color: '#7D8968' },
  photo: {
    width: '100%',
    height: 250,
    borderRadius: 20,
    backgroundColor: '#ECEDE3',
  },
  photoMissing: { padding: 16, borderRadius: 16, backgroundColor: '#ECEDE3' },
  locationCard: {
    padding: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E4DA',
    borderRadius: 22,
    gap: 12,
  },
  detailBody: {
    color: '#41493B',
    fontSize: 17,
    lineHeight: 29,
    paddingVertical: 8,
  },
  notice: { backgroundColor: '#FFF0D9', borderRadius: 14, padding: 16 },
  noticeText: { color: '#845F27', fontSize: 13, lineHeight: 21 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
