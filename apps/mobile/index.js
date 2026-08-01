import 'expo-router/entry';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/playback-service';

// Must run at module scope, right after the root component is registered, so
// the service is alive before any playback starts.
TrackPlayer.registerPlaybackService(() => PlaybackService);
