import { Platform, Share } from 'react-native';

/**
 * Opens the system share sheet for a link. iOS treats `url` and `message` as
 * two separate items, so passing both (with the link in the message too)
 * sent recipients two copies; on iOS send only the URL, which also gets a
 * rich preview in Messages. Android has no `url` field.
 */
export function shareLink(url: string) {
  return Share.share(Platform.OS === 'ios' ? { url } : { message: url });
}
