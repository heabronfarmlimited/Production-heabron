/**
 * NIN re-submission after rejection — ported from
 * modules/authentication/presentation/view/nin_update_view.dart
 *
 * Dart layout: 'Update NIN details', then a grey outlined box (radius 8,
 * grey @10 % fill) showing the literal 'Rejection: ' label above
 * `user?.nin?.rejectionReason`, then First name, Last name, NIN and Date of
 * birth, and a 'Submit' button.
 *
 * Prefill mirrors Dart: first = `fullName.split(' ').first`,
 * last = `fullName.split(' ').last`, nin and dob from the NIN record.
 *
 * NOTE — `POST /auth/resubmit-nin` takes a date-only `YYYY-MM-DD`, unlike
 * `signup/complete` which takes a full ISO timestamp. That asymmetry is in the
 * backend, so it is preserved in `authApi.resubmitNin`.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '../../../components/AppButton';
import { AppSkeleton } from '../../../components/AppSkeleton';
import { AppTextField } from '../../../components/AppTextField';
import { DateField } from '../../../components/DateField';
import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import { BadgeIcon, PersonIcon } from '../components/FieldIcons';
import { useResubmitNin } from '../hooks/useAuth';
import { useUser } from '../model/authStore';
import { ninUpdateSchema, type NinUpdateForm } from '../model/validation';

/** Dart: `initialDate: now - 365*20 days`. */
const twentyYearsAgo = (): Date => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d;
};

export function NinUpdateScreen() {
  const user = useUser();
  const { mutate: resubmit, isPending } = useResubmitNin();

  const nameParts = (user?.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.length > 1 ? (nameParts[nameParts.length - 1] ?? '') : '';

  // `date_of_birth` arrives as an ISO string; the form wants `YYYY-MM-DD`.
  const dob = user?.nin?.dateOfBirth ? user.nin.dateOfBirth.slice(0, 10) : '';
  const rejectionReason = user?.nin?.rejectionReason ?? '';

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<NinUpdateForm>({
    resolver: zodResolver(ninUpdateSchema),
    mode: 'onTouched',
    defaultValues: {
      firstName,
      lastName,
      nin: user?.nin?.nin ?? '',
      dateOfBirth: dob,
    },
  });

  return (
    <AppSkeleton
      isBusy={isPending}
      appBarTitle="Update NIN details"
      scrollable
    >
      <View style={{ height: h(8) }} />

      {rejectionReason ? (
        <View style={styles.rejectionBox}>
          {/* Dart rendered the literal label and the reason as two stacked texts. */}
          <Text style={styles.rejectionLabel}>Rejection: </Text>
          <Text style={styles.rejectionText}>{rejectionReason}</Text>
        </View>
      ) : null}

      <View style={{ height: h(24) }} />

      <Controller
        control={control}
        name="firstName"
        render={({ field }) => (
          <AppTextField
            title="First name"
            hintText="Enter first name"
            prefix={<PersonIcon />}
            autoCapitalize="words"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.firstName?.message}
            testID="nin-first-name"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="lastName"
        render={({ field }) => (
          <AppTextField
            title="Last name"
            hintText="Enter last name"
            prefix={<PersonIcon />}
            autoCapitalize="words"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={errors.lastName?.message}
            testID="nin-last-name"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="nin"
        render={({ field }) => (
          <AppTextField
            title="NIN"
            hintText="Enter NIN"
            prefix={<BadgeIcon />}
            keyboardType="number-pad"
            maxLength={11}
            value={field.value}
            onChangeText={(t) => field.onChange(t.replace(/\D/g, ''))}
            onBlur={field.onBlur}
            error={errors.nin?.message}
            testID="nin-number"
          />
        )}
      />

      <View style={{ height: h(16) }} />

      <Controller
        control={control}
        name="dateOfBirth"
        render={({ field }) => (
          <DateField
            title="Date of birth"
            hintText="Select date of birth"
            value={field.value}
            onChange={field.onChange}
            error={errors.dateOfBirth?.message}
            // Dart: initialDate now - 20y, firstDate 1900, lastDate now
            initialDate={twentyYearsAgo()}
            minimumDate={new Date(1900, 0, 1)}
            maximumDate={new Date()}
            testID="nin-dob"
          />
        )}
      />

      <View style={{ height: h(48) }} />

      <AppButton
        text="Submit"
        loading={isPending}
        onPress={handleSubmit((v) => resubmit(v))}
        testID="nin-submit"
      />

      <View style={{ height: h(24) }} />
    </AppSkeleton>
  );
}

const styles = StyleSheet.create({
  rejectionBox: {
    borderWidth: 1,
    borderColor: colors.grey,
    borderRadius: r(8),
    // Dart: grey @ 0.1
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    padding: r(12),
  },
  rejectionLabel: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.failure,
  },
  rejectionText: {
    ...textTheme.bodyMedium,
    fontSize: spMin(14),
    color: colors.greyDeep,
    marginTop: r(4),
  },
});
