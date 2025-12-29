import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Audio } from 'expo-av';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function HomeScreen() {
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [date, setDate] = useState(new Date());
  const [isScheduled, setIsScheduled] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  const STORAGE_KEY = 'SONG_TIMER_STATE';

  useEffect(() => {
    // 1. Permission and Audio Setup
    requestNotificationPermissions();

    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });

    // 2. Check for persisted schedule on app mount
    checkPersistedSchedule();

    // 3. Handle Notification Response (User tapped notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
       // When user interacts with notification, try to play the scheduled song
       restoreAndPlay();
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (notificationListener.current) {
          notificationListener.current.remove();
      }
      if (responseListener.current) {
          responseListener.current.remove();
      }
    };
  }, []);

  /* Function definition moved/replaced in previous tool call or handled here? 
     Wait, my previous tool call replaced lines 1 to 41. 
     The `requestNotificationPermissions` function was defined around line 66 in previous version. 
     I need to replace the *old* function definition with the new one. 
  */
  const requestNotificationPermissions = async () => {
      const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
      if (isExpoGo && Platform.OS === 'android') {
          console.log("Running in Expo Go on Android: Notifications implementation has changed in SDK 53.");
      }

      try {
        if (Platform.OS === 'android') {
            try {
                await Notifications.setNotificationChannelAsync('default', {
                    name: 'default',
                    importance: Notifications.AndroidImportance.MAX,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#FF231F7C',
                });
            } catch (e) {
                console.log("Failed to set notification channel:", e);
            }
        }

        if (Device.isDevice) {
            try {
                const { status: existingStatus } = await Notifications.getPermissionsAsync();
                let finalStatus = existingStatus;
                
                if (existingStatus !== 'granted') {
                    // explicit try/catch for requestPermissionsAsync in case it throws due to Expo Go limitations
                    try {
                        const { status } = await Notifications.requestPermissionsAsync();
                        finalStatus = status;
                    } catch (reqError: any) {
                        if (isExpoGo && reqError?.message?.includes('removed from Expo Go')) {
                            setStatusMessage('Use Dev Build for Notifications');
                            console.warn("Expo Go SDK 53: Remote notifications removed. Local permissions might fail.");
                            return; // Stop here
                        }
                        throw reqError;
                    }
                }
                if (finalStatus !== 'granted') {
                    console.log('Notification permissions not granted.');
                    setStatusMessage('Note: Notifications disabled.');
                    return;
                }
            } catch (e) {
                console.log("Failed to get/request permissions:", e);
                // If we are in Expo Go, this is expected for now
                if (isExpoGo) {
                    setStatusMessage('Notifications limited in Expo Go');
                }
            }
        }
      } catch (error) {
          console.log('General error requesting notification permissions:', error);
      }
  };

  const checkPersistedSchedule = async () => {
      try {
          const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
          if (jsonValue != null) {
              const savedState = JSON.parse(jsonValue);
              const targetTime = new Date(savedState.targetTime);
              const now = new Date();

              // If playing logic was supposed to happen in the past (while app was closed),
              // or is scheduled for the future
              if (savedState.uri) {
                   setSelectedFile({ 
                       uri: savedState.uri, 
                       name: savedState.name, 
                       mimeType: 'audio/*', 
                       size: 0,
                       lastModified: 0 // dummy
                    });
                   setDate(targetTime);
                   
                   const timeDiff = targetTime.getTime() - now.getTime();
                   if (timeDiff > 0) {
                        // Reschedule timer
                        setIsScheduled(true);
                        setStatusMessage(`Restored schedule: Plays in ${Math.ceil(timeDiff / 1000)}s`);
                        if (timerRef.current) clearTimeout(timerRef.current);
                        timerRef.current = setTimeout(() => playSong(savedState.uri), timeDiff);
                   } else {
                       // Time passed? Maybe auto-play if just opened via notification (handled by listener),
                       // or just show "Ready"
                       setStatusMessage('Scheduled time passed.');
                       // Optional: clear storage if you don't want it to persist forever
                       // await AsyncStorage.removeItem(STORAGE_KEY);
                   }
              }
          }
      } catch(e) {
          console.error("Failed to restore state", e);
      }
  };

  const restoreAndPlay = async () => {
      try {
        const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
        if (jsonValue != null) {
            const savedState = JSON.parse(jsonValue);
            if (savedState.uri) {
                // Ensure UI is synced
                setSelectedFile({ uri: savedState.uri, name: savedState.name, mimeType: 'audio/*', size: 0, lastModified: 0 });
                // Play immediately
                playSong(savedState.uri);
            }
        }
      } catch (e) {
          console.error("Error restoring and playing", e);
      }
  };

  const pickSong = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
        setStatusMessage('Song selected ready to schedule.');
        setIsScheduled(false);
        if (soundRef.current) {
            await soundRef.current.unloadAsync();
            soundRef.current = null;
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to pick song');
    }
  };

  const playSong = async (uri?: string) => {
    const playUri = uri || selectedFile?.uri;
    if (!playUri) return;

    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      console.log("Playing sound from:", playUri);
      const { sound } = await Audio.Sound.createAsync(
        { uri: playUri },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setStatusMessage('Playing song...');
      setIsScheduled(false);
      
      // Clear schedule once played
      await AsyncStorage.removeItem(STORAGE_KEY);

    } catch (error) {
      console.error("Play error:", error);
      Alert.alert('Error', 'Failed to play song. File might be inaccessible.');
    }
  };

  const handleSchedule = async () => {
    if (!selectedFile) {
      Alert.alert('Selection Required', 'Please select a song first.');
      return;
    }

    const now = new Date();
    const timeDiff = date.getTime() - now.getTime();

    if (timeDiff <= 0) {
      Alert.alert('Invalid Time', 'Please select a future time.');
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 1. Save state to storage
    const stateToSave = {
        uri: selectedFile.uri,
        name: selectedFile.name,
        targetTime: date.toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));

    // 2. Schedule Local Notification
    await Notifications.scheduleNotificationAsync({
        content: {
            title: "Song Timer",
            body: `Time to play: ${selectedFile.name}`,
            data: { uri: selectedFile.uri },
            sound: true, 
        },
        trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.ceil(timeDiff / 1000), 
            channelId: 'default',
        },
    });

    // 3. Set Local Timer (for foreground)
    setIsScheduled(true);
    setStatusMessage(`Scheduled to play in ${Math.ceil(timeDiff / 1000)} seconds.`);

    timerRef.current = setTimeout(() => {
      playSong(selectedFile.uri);
    }, timeDiff);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    const currentDate = selectedDate || date;
    setShowDatePicker(Platform.OS === 'ios'); 
    setDate(currentDate);
  };

  const cancelSchedule = async () => {
      if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
      }
      setIsScheduled(false);
      setStatusMessage('Schedule cancelled.');
      if(soundRef.current) {
          soundRef.current.stopAsync();
      }
      
      // Clear persistence and notifications
      await AsyncStorage.removeItem(STORAGE_KEY);
      await Notifications.cancelAllScheduledNotificationsAsync();
  };

  return (
    <View className="flex-1 bg-slate-900 px-6 py-12 justify-center">
      <View className="items-center mb-10">
        <Ionicons name="musical-notes" size={64} color="#60a5fa" />
        <Text className="text-3xl font-bold text-white mt-4">Song Timer</Text>
        <Text className="text-slate-400 mt-2 text-center">Select a track and set a time to play</Text>
      </View>

      <View className="bg-slate-800 p-6 rounded-2xl shadow-lg border border-slate-700">
        {/* Song Selection */}
        <TouchableOpacity 
          onPress={pickSong}
          className="bg-slate-700 p-4 rounded-xl flex-row items-center border border-slate-600 mb-6"
        >
          <Ionicons name="folder-open-outline" size={24} color="#94a3b8" />
          <View className="ml-3 flex-1">
            <Text className="text-slate-400 text-xs uppercase font-bold tracking-wider">Selected Track</Text>
            <Text className="text-white font-medium truncate" numberOfLines={1}>
              {selectedFile ? selectedFile.name : 'Tap to select audio file'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Time Selection */}
        <View className="mb-8">
            <Text className="text-slate-400 text-xs uppercase font-bold tracking-wider mb-2">Start Time</Text>
            
            {Platform.OS === 'android' && (
                <TouchableOpacity 
                    onPress={() => setShowDatePicker(true)}
                    className="bg-slate-700 p-4 rounded-xl border border-slate-600"
                >
                    <Text className="text-white text-lg text-center">
                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                </TouchableOpacity>
            )}

            {(showDatePicker || Platform.OS === 'ios') && (
                <View className="bg-slate-700 rounded-xl overflow-hidden mt-2">
                     <DateTimePicker
                        testID="dateTimePicker"
                        value={date}
                        mode="time"
                        is24Hour={true}
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={onDateChange}
                        textColor="white"
                    />
                     {Platform.OS === 'ios' && <View className="h-4" />} 
                </View>
            )}
        </View>

        {/* Status */}
        {statusMessage ? (
             <View className="mb-6 p-3 bg-slate-900/50 rounded-lg border border-slate-700/50">
                <Text className="text-blue-400 text-center text-sm">{statusMessage}</Text>
             </View>
        ) : null}


        {/* Action Button */}
        {!isScheduled ? (
            <TouchableOpacity
            onPress={handleSchedule}
            className={`p-4 rounded-xl flex-row justify-center items-center ${selectedFile ? 'bg-blue-600' : 'bg-slate-700 opacity-50'}`}
            disabled={!selectedFile}
            >
            <Ionicons name="timer-outline" size={24} color="white" />
            <Text className="text-white font-bold text-lg ml-2">Schedule Playback</Text>
            </TouchableOpacity>
        ) : (
             <TouchableOpacity
            onPress={cancelSchedule}
            className="bg-red-500 p-4 rounded-xl flex-row justify-center items-center"
            >
            <Ionicons name="stop-circle-outline" size={24} color="white" />
            <Text className="text-white font-bold text-lg ml-2">Stop / Cancel</Text>
            </TouchableOpacity>
        )}
       
      </View>
    </View>
  );
}