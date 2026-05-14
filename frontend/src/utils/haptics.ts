import * as Haptics from 'expo-haptics';

export const haptic = {
  // Light tap — buttons, toggles, nav
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  // Medium — confirm actions, send, call
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  // Heavy — errors, destructive actions
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  // Success — unlock, send success
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  // Error — wrong PIN, failed action
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  // Warning
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  // Selection change — scroll items, tab switch
  selection: () => Haptics.selectionAsync(),
};
