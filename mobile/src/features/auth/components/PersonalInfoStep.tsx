/**
 * Registration step 3 — ported from
 * .../view/widgets/personal_info_step.dart
 *
 * Dart order: the 150r circular selfie target (tap -> selfie route, placeholder
 * shows a camera chip and 'Tap to take your selfie'), 24 space, then Fullname,
 * Phone Number, National Identification Number (NIN), Date of Birth, and the
 * State / LGA pair.
 *
 * FIXED — two things from the Dart version:
 *  1. It rendered stray `Text('Select State')` and `Text('Select LGA')` labels
 *     directly above `StateLgaDropdown`, which renders its own 'State' and
 *     'Local Government Area' titles, so both labels appeared twice. Removed.
 *  2. State/LGA were not part of the form, so a missing value surfaced as a
 *     toast after submit. They are now required form fields with inline errors.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import { StateLgaDropdown } from '../../../components/StateLgaDropdown';
import { routes } from '../../../core/navigation/routes';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { showError } from '../../../core/utils/toast';
import { uploadFile } from '../api/authApi';
import { useCompleteSignup } from '../hooks/useAuth';
import { useRegistrationStore } from '../model/registrationStore';
import { personalInfoSchema, type PersonalInfoForm } from '../model/validation';

import { BadgeIcon, CameraIcon, PersonIcon, PhoneIcon } from './FieldIcons';

/** An agent must be at least 18 — Dart `lastDate: now - 365*18 days`. */
const eighteenYearsAgo = (): Date => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d;
};

export function PersonalInfoStep() {
  const router = useRouter();
  const selfie = useRegistrationStore((s) => s.selfie);
  const selfieUrl = useRegistrationStore((s) => s.selfieUrl);
  const setSelfieUrl = useRegistrationStore((s) => s.setSelfieUrl);
  const reset = useRegistrationStore((s) => s.reset);

  const { mutate: complete, isPending } = useCompleteSignup();

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PersonalInfoForm>({
    resolver: zodResolver(personalInfoSchema),
    mode: 'onTouched',
    defaultValues: {
      fullName: '',
      phone: '',
      nin: '',
      dateOfBirth: '',
      state: '',
      lga: '',
    },
  });

  const state = watch('state');
  const lga = watch('lga');

  const onSubmit = async (values: PersonalInfoForm) => {
    // The selfie is required: the backend stores it as the identity evidence.
    if (!selfie && !selfieUrl) {
      showError('Please upload a profile image');
      return;
    }

    let url = selfieUrl;

    // Uploaded here rather than at capture time, matching the Dart flow —
    // it goes to `/auth/uploads/avatar`, the pre-approval route, which accepts
    // a token for an account that is not yet active.
    if (!url && selfie) {
      try {
        url = await uploadFile({
          uri: selfie.uri,
          kind: 'avatar',
          fileName: selfie.fileName,
          mimeType: selfie.mimeType,
          preAuth: true,
        });
        setSelfieUrl(url);
      } catch {
        showError('Could not upload your photo. Please try again.');
        return;
      }
    }

    if (!url) {
      showError('Please upload a profile image');
      return;
    }

    complete(
      {
        fullName: values.fullName.trim(),
        phone: values.phone.trim(),
        nin: values.nin.trim(),
        dateOfBirth: values.dateOfBirth,
        state: values.state,
        lga: values.lga,
        selfieUrl: url,
      },
      { onSuccess: () => reset() },
    );
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take your selfie"
        style={styles.selfieWrap}
        onPress={() => router.push(routes.registerSelfie)}
      >
        <View style={styles.selfieRing}>
          {selfie ? (
            <Image source={{ uri: selfie.uri }} style={styles.selfieImage} />
          ) : (
            <View style={styles.selfiePlaceholder}>
              <View style={styles.cameraChip}>
                <CameraIcon color={colors.primary} size={28} />
              </View>
              <View style={{ height: h(14) }} />
              <Text style={styles.selfieLabel}>Tap to take your selfie</Text>
            </View>
          )}
        </View>
      </Pressable>

      <View style={{ height: h(24) }} />

      <Controller
        control={control}
        name="fullName"
        render={({ field }) => (
          <AppTextField
            title="Fullname"
            hintText="Enter your Fullname"
            prefix={<PersonIcon />}
            autoCapitalize="words"
            autoComplete="name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.fullName?.message}
            testID="register-fullname"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <AppTextField
            title="Phone Number"
            hintText="Enter your phone number"
            prefix={<PhoneIcon />}
            keyboardType="phone-pad"
            autoComplete="tel"
            maxLength={11}
            value={field.value}
            // Dart: FilteringTextInputFormatter.digitsOnly
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.phone?.message}
            testID="register-phone"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="nin"
        render={({ field }) => (
          <AppTextField
            title="National Identification Number (NIN)"
            hintText="Enter your NIN"
            prefix={<BadgeIcon />}
            keyboardType="number-pad"
            maxLength={11}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.nin?.message}
            testID="register-nin"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="dateOfBirth"
        render={({ field }) => (
          <DateField
            title="Date of Birth"
            hintText="Select date of birth"
            value={field.value}
            onChange={field.onChange}
            error={errors.dateOfBirth?.message}
            // Dart: initialDate 2000, firstDate 1940, lastDate now - 18y
            initialDate={new Date(2000, 0, 1)}
            minimumDate={new Date(1940, 0, 1)}
            maximumDate={eighteenYearsAgo()}
            testID="register-dob"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <StateLgaDropdown
        state={state}
        lga={lga}
        onStateChange={(next) => setValue('state', next, { shouldValidate: true })}
        onLgaChange={(next) => setValue('lga', next, { shouldValidate: true })}
        stateError={errors.state?.message}
        lgaError={errors.lga?.message}
      />

      <View style={{ height: h(68) }} />

      <AppButton
        text="Submit"
        loading={isPending}
        onPress={handleSubmit(onSubmit)}
        testID="register-submit"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  selfieWrap: {
    alignSelf: 'center',
  },
  selfieRing: {
    width: r(150),
    height: r(150),
    borderRadius: r(150),
    borderWidth: 2,
    // Dart: AppColors.primary.withValues(alpha: 0.35)
    borderColor: 'rgba(46, 139, 87, 0.35)',
    overflow: 'hidden',
  },
  selfieImage: {
    width: '100%',
    height: '100%',
  },
  selfiePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Dart: AppColors.primary.withValues(alpha: 0.08)
    backgroundColor: 'rgba(46, 139, 87, 0.08)',
    paddingHorizontal: r(12),
  },
  cameraChip: {
    padding: r(14),
    borderRadius: r(100),
    // Dart: AppColors.primary.withValues(alpha: 0.18)
    backgroundColor: 'rgba(46, 139, 87, 0.18)',
  },
  selfieLabel: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    color: colors.primary,
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    textAlign: 'center',
  },
});
