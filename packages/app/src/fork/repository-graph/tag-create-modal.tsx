import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";

interface TagCreateModalProps {
  onClose: () => void;
  onSubmit: (options: { name: string; pushToRemote: boolean }) => Promise<void>;
}

export function TagCreateModal({ onClose, onSubmit }: TagCreateModalProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [name, setName] = useState("");
  const [pushToRemote, setPushToRemote] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedName = name.trim();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("workspace.repositoryGraph.actions.createTag") }),
    [t],
  );
  const togglePushToRemote = useCallback((value: boolean) => setPushToRemote(value), []);
  const handleClose = useCallback(() => {
    if (!isPending) onClose();
  }, [isPending, onClose]);
  const submit = useCallback(async () => {
    if (!trimmedName || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await onSubmit({ name: trimmedName, pushToRemote });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : t("workspace.repositoryGraph.actions.createFailed"),
      );
      setIsPending(false);
    }
  }, [isPending, onClose, onSubmit, pushToRemote, t, trimmedName]);
  const submitVoid = useCallback(() => void submit(), [submit]);
  const footer = useMemo(
    () => (
      <View style={styles.actions}>
        <Button variant="secondary" size="md" style={styles.button} onPress={handleClose}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          size="md"
          style={styles.button}
          loading={isPending}
          disabled={!trimmedName || isPending}
          onPress={submitVoid}
          testID="repository-graph-create-tag-submit"
        >
          {t("workspace.repositoryGraph.actions.create")}
        </Button>
      </View>
    ),
    [handleClose, isPending, submitVoid, t, trimmedName],
  );

  return (
    <AdaptiveModalSheet
      visible
      onClose={handleClose}
      header={header}
      footer={footer}
      desktopMaxWidth={440}
      testID="repository-graph-create-tag"
    >
      <View style={styles.body}>
        <Field label={t("workspace.repositoryGraph.actions.tagName")} error={error}>
          <FormTextInput
            size={isCompact ? "md" : "sm"}
            initialValue=""
            onChangeText={setName}
            placeholder={t("workspace.repositoryGraph.actions.tagNamePlaceholder")}
            accessibilityLabel={t("workspace.repositoryGraph.actions.tagName")}
            editable={!isPending}
            autoCapitalize="none"
            autoCorrect={false}
            testID="repository-graph-create-tag-name"
          />
        </Field>
        <View style={styles.option}>
          <Text style={styles.optionLabel}>
            {t("workspace.repositoryGraph.actions.pushTagToRemote")}
          </Text>
          <Switch
            value={pushToRemote}
            onValueChange={togglePushToRemote}
            disabled={isPending}
            accessibilityLabel={t("workspace.repositoryGraph.actions.pushTagToRemote")}
            testID="repository-graph-create-tag-push"
          />
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  option: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  optionLabel: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", gap: theme.spacing[2] },
  button: { flex: 1 },
}));
