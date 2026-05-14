import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

async function getToken() {
  return await AsyncStorage.getItem('iona_token');
}

async function authFetch(path: string, options: RequestInit = {}) {
  const token = await getToken();
  const headers: any = { ...options.headers, 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `Error ${res.status}`);
  }
  return res.json();
}

// Generic request helper used by sovereign screen
const authRequest = authFetch;

export const api = {
  // ─── Auth ───
  register: (data: any) => authFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Contacts ───
  getContacts: () => authFetch('/api/contacts'),
  createContact: (data: any) => authFetch('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
  deleteContact: (id: string) => authFetch(`/api/contacts/${id}`, { method: 'DELETE' }),
  // ─── Messages ───
  getConversations: () => authFetch('/api/messages'),
  getMessages: (contactId: string) => authFetch(`/api/messages/${contactId}`),
  sendMessage: (data: any) => authFetch('/api/messages', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Calls ───
  getCalls: () => authFetch('/api/calls'),
  createCall: (data: any) => authFetch('/api/calls', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Wallet ───
  getWallet: () => authFetch('/api/wallet'),
  sendTokens: (data: any) => authFetch('/api/wallet/send', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Blockchain ───
  getNodes: () => authFetch('/api/blockchain/nodes'),
  getBlockchainStatus: () => authFetch('/api/blockchain/status'),
  // ─── Settings ───
  getSettings: () => authFetch('/api/settings'),
  updateSettings: (data: any) => authFetch('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  // ─── IONA Agent State API v1.0 ───
  getAgentStatus: () => authFetch('/api/agent/status'),
  getAgentLogs: () => authFetch('/api/agent/logs'),
  sendAgentCommand: (command: string, value?: number) =>
    authFetch('/api/agent/command', { method: 'POST', body: JSON.stringify({ command, value: value ?? 0 }) }),
  // ─── Admin API Bridge (kernel port 7777) ───
  getKernelHealth: () => authFetch('/api/kernel/health'),
  getKernelStatus: () => authFetch('/api/kernel/status'),
  getKernelIntegrity: () => authFetch('/api/kernel/integrity'),
  getKernelMetrics: () => authFetch('/api/kernel/metrics'),
  // ─── Terminal Execution ───
  execTerminalCommand: (command: string, cwd: string) =>
    authFetch('/api/terminal/exec', { method: 'POST', body: JSON.stringify({ command, cwd }) }),
  // ─── Protocol v37.3 Bridge ───
  getProtocolStatus: () => authFetch('/api/protocol/status'),
  getProtocolBlock: (height: number) => authFetch(`/api/protocol/block/${height}`),
  getProtocolValidators: () => authFetch('/api/protocol/validators'),
  getValidatorHeatmap: () => authFetch('/api/protocol/validator-heatmap'),
  signTransaction: (data: any) => authFetch('/api/protocol/sign-tx', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Bridge status ───
  getBridgeStatus: () => authFetch('/api/bridge/status'),
  getHamiltonianStream: () => authFetch('/api/bridge/hamiltonian-stream'),
  // ─── HAL (Hardware Abstraction Layer) ───
  getHalStatus: () => authFetch('/api/hal/status'),
  // ─── Persistence / Black Box ───
  getCheckpoints: () => authFetch('/api/persistence/checkpoints'),
  checkpointNow: () => authFetch('/api/persistence/checkpoint-now', { method: 'POST' }),
  // ─── Mesh Networking ───
  getMeshPeers: () => authFetch('/api/mesh/peers'),
  requestMeshStability: () => authFetch('/api/mesh/request-stability', { method: 'POST' }),
  // ─── Semantic Log Search ───
  analyzeLogs: () => authFetch('/api/logs/analyze'),
  searchLogs: (q: string, limit = 20) => authFetch(`/api/logs/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  // ─── Security / Dead Man's Switch ───
  getSecurityStatus: () => authFetch('/api/security/status'),
  configureVault: (data: any) => authFetch('/api/security/configure-vault', { method: 'POST', body: JSON.stringify(data) }),
  physicalTrigger: (sequence: string[]) => authFetch('/api/security/physical-trigger', { method: 'POST', body: JSON.stringify({ sequence }) }),
  multisigTransaction: (data: any) => authFetch('/api/security/multisig-tx', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Scenario Engine ───
  runScenario: () => authFetch('/api/scenario/run', { method: 'POST' }),
  getScenarioStatus: () => authFetch('/api/scenario/status'),
  // ─── Messaging (Double Ratchet) ───
  getInbox: () => authFetch('/api/messages/inbox'),
  markRead: (id: string) => authFetch(`/api/messages/read/${id}`, { method: 'POST' }),
  sendTestMessage: () => authFetch('/api/messages/send-test', { method: 'POST' }),
  // ─── VFS ───
  getVfsStatus: () => authFetch('/api/vfs/status'),
  vfsWrite: (path: string, content: string) => authFetch('/api/vfs/write', { method: 'POST', body: JSON.stringify({ path, content }) }),
  vfsRead: (path: string) => authFetch(`/api/vfs/read/${path.replace(/^\//, '')}`),
  vfsThaw: () => authFetch('/api/vfs/thaw', { method: 'POST' }),
  // ─── Oracle ───
  getOracleFeeds: () => authFetch('/api/oracle/feeds'),
  getOracleHealth: () => authFetch('/api/oracle/health'),
  // ─── WASM Sandbox ───
  sandboxStatus: () => authFetch('/api/sandbox/status'),
  sandboxRegister: (data: any) => authFetch('/api/sandbox/register', { method: 'POST', body: JSON.stringify(data) }),
  sandboxRun: (data: any) => authFetch('/api/sandbox/run', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Neural Interface ───
  neuralStatus: () => authFetch('/api/neural/status'),
  neuralVoice: (data: any) => authFetch('/api/neural/voice', { method: 'POST', body: JSON.stringify(data) }),
  neuralGesture: (gesture: string, accel_data?: any[]) => authFetch('/api/neural/gesture', { method: 'POST', body: JSON.stringify({ gesture, confidence: 0.95, accel_data: accel_data || [] }) }),
  // ─── WASM v2 (Real bytecode interpreter) ───
  sandboxV2Register: (data: any) => authFetch('/api/sandbox/v2/register', { method: 'POST', body: JSON.stringify(data) }),
  sandboxV2Run: (data: any) => authFetch('/api/sandbox/v2/run', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Bridge v2 (Auto-discovery) ───
  getBridgeV2Status: () => authFetch('/api/bridge/v2/status'),
  discoverKernel: () => authFetch('/api/bridge/v2/discover', { method: 'POST' }),
  setKernelUrl: (url: string) => authFetch('/api/bridge/v2/set-kernel-url', { method: 'POST', body: JSON.stringify({ url }) }),
  // ─── Sovereign Identity (IonaSovereignCircuit) ───
  sovereignEnroll: (key_seed?: string) => authFetch('/api/sovereign/enroll', { method: 'POST', body: JSON.stringify({ key_seed }) }),
  sovereignChallenge: () => authFetch('/api/sovereign/challenge', { method: 'POST' }),
  sovereignProve: (data: any) => authFetch('/api/sovereign/prove', { method: 'POST', body: JSON.stringify(data) }),
  sovereignVerify: (data: any) => authFetch('/api/sovereign/verify', { method: 'POST', body: JSON.stringify(data) }),
  sovereignStatus: () => authFetch('/api/sovereign/status'),
  sovereignBootVerify: (entropy_seed?: string) => authFetch('/api/sovereign/boot-verify', { method: 'POST', body: JSON.stringify({ entropy_seed }) }),
  // ─── Secure Enclave TEE ───
  enclaveStatus: () => authFetch('/api/enclave/status'),
  enclaveStore: (kind: number, data_hex: string) => authFetch('/api/enclave/store', { method: 'POST', body: JSON.stringify({ kind, data_hex }) }),
  enclaveWipe: () => authFetch('/api/enclave/wipe', { method: 'POST' }),
  enclaveGenerateNullifier: () => authFetch('/api/enclave/generate-nullifier', { method: 'POST' }),
  // ─── Genesis Recovery ───
  genesisCreateCapsule: () => authFetch('/api/genesis/create-capsule', { method: 'POST' }),
  genesisRecover: (capsule?: any) => authFetch('/api/genesis/attempt-recovery', { method: 'POST', body: JSON.stringify({ capsule }) }),
  genesisStatus: () => authFetch('/api/genesis/status'),
  // ─── Secure File System ───
  secureFileWrite: (path: string, content: string) => authFetch('/api/secure-file/write', { method: 'POST', body: JSON.stringify({ path, content }) }),
  secureFileRead: (path: string) => authFetch(`/api/secure-file/read?path=${encodeURIComponent(path)}`),
  // ─── Shell State ───
  getShellState: () => authFetch('/api/shell/state'),
  // ─── Mesh+ (Routing, SNF, RF) ───
  getRoutingTable: () => authFetch('/api/mesh/routing-table'),
  announceRoute: (d: any) => authFetch('/api/mesh/announce-route', { method: 'POST', body: JSON.stringify(d) }),
  snfStore: (d: any) => authFetch('/api/mesh/store-packet', { method: 'POST', body: JSON.stringify(d) }),
  snfFetch: (prefix?: string) => authFetch(`/api/mesh/fetch-packets${prefix ? '?to_prefix='+prefix : ''}`),
  snfStatus: () => authFetch('/api/mesh/snf-status'),
  rfStatus: () => authFetch('/api/rf/status'),
  rfConfigure: (d: any) => authFetch('/api/rf/configure', { method: 'POST', body: JSON.stringify(d) }),
  // ─── App Registry ───
  appRegister: (d: any) => authFetch('/api/apps/register', { method: 'POST', body: JSON.stringify(d) }),
  appRun: (d: any) => authFetch('/api/apps/run', { method: 'POST', body: JSON.stringify(d) }),
  appRegistry: () => authFetch('/api/apps/registry'),
  // ─── Identity Revocation ───
  revokeIdentity: (d: any) => authFetch('/api/identity/revoke', { method: 'POST', body: JSON.stringify(d) }),
  revocationList: () => authFetch('/api/identity/revocation-list'),
  checkRevoked: (mandate_hex: string) => authFetch(`/api/identity/check-revoked?mandate_hex=${mandate_hex}`),
  // ─── State Channels ───
  channelOpen: (d: any) => authFetch('/api/wallet/channel-open', { method: 'POST', body: JSON.stringify(d) }),
  channelUpdate: (d: any) => authFetch('/api/wallet/channel-update', { method: 'POST', body: JSON.stringify(d) }),
  channelClose: (d: any) => authFetch('/api/wallet/channel-close', { method: 'POST', body: JSON.stringify(d) }),
  listChannels: () => authFetch('/api/wallet/channels'),
  // ─── Hardware Defense ───
  hwDefenseStatus: () => authFetch('/api/hardware/defense-status'),
  busScramblerToggle: () => authFetch('/api/hardware/bus-scrambler-toggle', { method: 'POST' }),
  acousticScan: () => authFetch('/api/hardware/acoustic-scan', { method: 'POST' }),
  // ─── Sovereign Time ───
  getTimeConsensus: () => authFetch('/api/time/consensus'),
  submitTimeSample: (data: any) => authFetch('/api/time/submit-sample', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Shadow Mirroring / Sharding ───
  fsDisperse: (data: any) => authFetch('/api/fs/disperse', { method: 'POST', body: JSON.stringify(data) }),
  fsReconstitute: (data: any) => authFetch('/api/fs/reconstitute', { method: 'POST', body: JSON.stringify(data) }),
  getShardStatus: () => authFetch('/api/fs/shard-status'),
  // ─── Duress + Cognitive ───
  duressSetup: (data: any) => authFetch('/api/security/duress-setup', { method: 'POST', body: JSON.stringify(data) }),
  duressAuth: (data: any) => authFetch('/api/security/duress-auth', { method: 'POST', body: JSON.stringify(data) }),
  cognitiveAuth: (sequence: any[]) => authFetch('/api/security/cognitive-auth', { method: 'POST', body: JSON.stringify({ sequence }) }),
  getCognitiveGrid: () => authFetch('/api/security/cognitive-grid'),
  getDuressStatus: () => authFetch('/api/security/duress-status'),
  // ─── Self-Healing FS ───
  fsScrub: () => authFetch('/api/fs/integrity-scrub', { method: 'POST' }),
  getScrubStatus: () => authFetch('/api/fs/scrub-status'),
  // ─── Viral Recruitment ───
  offerStorage: (data: any) => authFetch('/api/mesh/offer-storage', { method: 'POST', body: JSON.stringify(data) }),
  acceptStorage: (data: any) => authFetch('/api/mesh/accept-storage', { method: 'POST', body: JSON.stringify(data) }),
  getRecruitmentStatus: () => authFetch('/api/mesh/recruitment-status'),
  // ─── Radar + Audit ───
  getMeshRadar: () => authFetch('/api/mesh/radar'),
  getAuditTrail: (source?: string, limit?: number) => authFetch(`/api/audit/trail?source=${source||'all'}&limit=${limit||50}`),
  // ─── ZK Identity ───
  zkRequestChallenge: () => authFetch('/api/zk/request-challenge', { method: 'POST' }),
  zkProve: (data: any) => authFetch('/api/zk/prove', { method: 'POST', body: JSON.stringify(data) }),
  zkVerifySession: (data: any) => authFetch('/api/zk/verify-session', { method: 'POST', body: JSON.stringify(data) }),
  zkStatus: () => authFetch('/api/zk/status'),
  // ─── OTA Updates ───
  otaStatus: () => authFetch('/api/ota/status'),
  otaStage: (data: any) => authFetch('/api/ota/stage-update', { method: 'POST', body: JSON.stringify(data) }),
  otaApply: () => authFetch('/api/ota/apply', { method: 'POST' }),
  // ─── Noise Injection ───
  noiseStatus: () => authFetch('/api/noise/status'),
  configureNoise: (data: any) => authFetch('/api/noise/configure', { method: 'POST', body: JSON.stringify(data) }),
  // ─── Biometrics ───
  biometricsStatus: () => authFetch('/api/biometrics/status'),
  recordBiometricEvent: (data: any) => authFetch('/api/biometrics/event', { method: 'POST', body: JSON.stringify(data) }),
  biometricsVerify: (method: string) => authFetch('/api/biometrics/verify', { method: 'POST', body: JSON.stringify({ method }) }),
  resetBiometricBaseline: () => authFetch('/api/biometrics/reset-baseline', { method: 'POST' }),
};
