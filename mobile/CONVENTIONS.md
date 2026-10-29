# Conventions

Read this before adding code. The foundation in `src/core` and `src/components`
is settled — build features on top of it rather than introducing parallel
patterns.

## Stack

| Concern | Choice | Replaces (Flutter) |
|---|---|---|
| Navigation | `expo-router` (file-based) | `RouteGenerator.generateRoute` switch |
| Server state | TanStack Query | `ChangeNotifier` + Hive-as-view-model |
| Session state | Zustand (`useAuthStore`) | `UserListener` + `AuthLocalRepository` |
| Forms | React Hook Form + Zod | `GlobalKey<FormState>` + `form_builder_validators` |
| Storage | MMKV | Hive |
| HTTP | axios (`src/core/api/client.ts`) | Dio + `NetworkInterceptor` |
| Styling | `StyleSheet` + theme tokens | `ThemeData` + `flutter_screenutil` |
| Lists | FlashList | `ListView.builder` / Slivers |
| Toasts | `react-native-toast-message` | toastification |

## Hard rules

1. **No fake, demo, or placeholder data.** Ever. If the API has no value, show
   an empty state. The Flutter app shipped invented PDF tables, a `455`
   land-size fallback, `'76'`/`'12'` stat literals and `"Dev innov8"` leader
   fallbacks — none of that is reproduced.
2. **Never send a display label to the API.** Use `src/core/api/domainConstants.ts`,
   which pairs each UI label with the value the Joi validator accepts.
3. **All API calls go through `api` from `src/core/api/client.ts`.** It unwraps
   the `ServerResponse` envelope, throws `AppError`, and handles 401 refresh.
   Never call axios directly.
4. **Paginated lists use `usePaginatedList`.** Do not hand-roll page counters.
5. **Mutations invalidate with a `qk.*` key** from `queryClient.ts`.
6. **Scale every dimension.** `r()` for padding/radius, `w()`/`h()` for sizes,
   `spMin()` for font sizes — from `src/core/theme/responsive.ts`. No raw pixels.
7. **Colours come from `colors`**, type from `textTheme` / `textStyles`. No hex
   literals in screens; if a Flutter screen used a one-off hex, add it as a
   local `const` with a comment naming the source.
8. **Strings are preserved verbatim** from the Flutter screens — every label,
   hint, button, empty state, toast and validation message. The audits in
   `/home/claude/analysis/*.md` have the literals.
9. **TypeScript strict.** No `any`. Parse API responses through a `parseX`
   function that tolerates nulls, as the Dart `fromJson` factories did.
10. **Comment the *why*, not the *what*.** Where behaviour diverges from
    Flutter, say so in one line prefixed `NOTE —` or `FIXED —`.

## Layout

```
src/
  app/                      # expo-router routes (thin — screens live in features)
  core/
    api/        client.ts endpoints.ts types.ts AppError.ts
                domainConstants.ts queryClient.ts
    config/     env.ts
    hooks/      usePaginatedList.ts useMediaPicker.ts useLocation.ts
    navigation/ routes.ts
    storage/    storage.ts authStorage.ts
    theme/      colors.ts typography.ts responsive.ts assets.ts
    utils/      format.ts toast.ts
  components/               # shared widgets (lib/src/shared equivalents)
  features/<module>/
    api/        <module>Api.ts      # endpoint calls, returns domain models
    model/      <type>.ts           # interfaces + parseX/serializeX + schemas
    hooks/      use<Thing>.ts       # queries/mutations wrapping the api layer
    screens/    <Screen>.tsx        # the UI
    components/                     # module-only widgets
  assets/       fonts/ images/ icons/ json/
```

## Model pattern

Mirror the Dart DTOs but normalise the casing chaos. The API returns
**snake_case** on reads and expects **camelCase** on writes, and some DTOs
(`ProductionYield`, `FinancingHistoryItem`) accept both on read. Handle that
once, in the parser:

```ts
export interface Farmer { id: string; fullName: string; /* … */ }

/** Tolerates both snake_case and camelCase, as the Dart fromJson did. */
export function parseFarmer(raw: unknown): Farmer {
  const f = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(f.id),
    fullName: str(f.full_name ?? f.fullName),
    // …
  };
}

/** Request bodies are camelCase — see backend/src/validators/domain.js */
export function toCreateFarmerBody(form: FarmerForm): Record<string, unknown> { /* … */ }
```

Helpers `str`, `num`, `bool`, `nullableStr` are in each model file; keep them
local and small rather than building a validation framework.

## Screen pattern

```tsx
export function FarmersScreen() {
  const { items, isLoading, hasNextPage, loadMore, refresh, isRefetching } =
    useFarmers({ search });

  return (
    <AppSkeleton isBusy={isLoading && items.length === 0} appBarTitle="Farmers">
      <FlashList
        data={items}
        renderItem={({ item }) => <FarmerScoreTile farmer={item} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refresh} />
        }
        ListEmptyComponent={!isLoading ? <EmptyState text="No farmers found" /> : null}
        ListFooterComponent={hasNextPage ? <AppLoading color={colors.primary} /> : null}
      />
    </AppSkeleton>
  );
}
```

`isBusy` blocks only on the first load — a refresh must not cover the list with
an overlay (the Flutter `AppSkeleton` did, which is why lists flickered).

## Form pattern

```tsx
const { control, handleSubmit, formState: { errors } } = useForm<BankAccountForm>({
  resolver: zodResolver(bankAccountSchema),
  mode: 'onTouched',          // Dart: AutovalidateMode.onUserInteraction
  defaultValues: { bankName: '', accountNumber: '', accountName: '' },
});

const { mutate, isPending } = useSaveBankAccount();

<Controller
  control={control}
  name="accountNumber"
  render={({ field }) => (
    <AppTextField
      title="Account Number"
      hintText="Enter 10-digit account number"
      keyboardType="number-pad"
      maxLength={10}
      value={field.value}
      onChangeText={field.onChange}
      onBlur={field.onBlur}
      error={errors.accountNumber?.message}
    />
  )}
/>
```

Server-side field errors come back as `AppError.fieldErrors` — map them onto
the form with `setError` so a 422 lands on the offending input instead of a toast.

## Don't port

- `onboarding_controller.dart`, `onboarding.dart`, `onboarding_view.dart` —
  content from an unrelated product (a cycle tracker); the view is 100 %
  commented out and unreachable.
- `core/utils/enum.dart` (`PeriodStates`) — same origin.
- `CooperativeExportService` — 500 LOC, its only call site is commented out,
  and its tables are hardcoded.
- `dashboard/.../widgets/personal_info_step.dart` — orphan duplicate of the
  auth step.
- The `uteriflow.com` base-URL defaults.
- `kDebugMode` credential prefills in `RegisterController` / `LoginController`.
- `AppState.error` (never assigned), `WalletController.requestSettlement`
  (never called), `*Response.fromJson` (never invoked).

## Known Flutter defects — fixed here, keep them fixed

| Defect | Fix |
|---|---|
| Pagination re-fetches the last page forever | `usePaginatedList` derives the cursor from `meta` |
| `EditFarmer` submits `''`/`0` for unprefilled farm fields, wiping server data | Prefill every field; send only changed values |
| Cooperative lat/lng regex `^\d+\.?\d{0,2}` rejects negatives, truncates to 2 dp | Numeric input validated against ±90 / ±180 |
| `tier` filter is free text; the validator only accepts `A`–`D` | Fixed four-option picker |
| `FieldNotes`/`MarketAccess` never clear loading on success | Mutations handle it |
| `EditCooperative` calls `fetchMore()` so edits don't refresh | Invalidate `qk.cooperative(id)` |
| Dashboard "Add farmer" opens the Cooperatives tab | Routes to Farmers |
| Reset-password fields unmasked, weaker rules than registration | Masked, same complexity schema |
| Login/register email fields omit `required()` | `.min(1, 'Email is required')` |
| Repayment proof labelled Optional but required | Labelled required |
| `dependents` forced `min(1)`; backend allows 0 | `min(0)` |
| `secondaryCrops` unbounded; validator caps at 7 | Enforced at 7 |
| Farmer-dropdown label shows a raw UUID | Shows the farmer's name |
| `signup/complete` sent without the bearer token | Client attaches it |
| Offline auto-sync never starts (`init()` uncalled) | Wired to connectivity |

## Checks

```bash
npm run typecheck && npm run lint && npm run test
```
