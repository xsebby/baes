import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/auth';

export default function Index() {
  const { ready, user } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return <Redirect href={user ? '/home' : '/login'} />;
}
