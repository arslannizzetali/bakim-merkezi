"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/lib/api/auth.api";
import { ApiClientError } from "@/lib/api/client";
import { useAuthStore } from "@/lib/store/auth.store";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, isAuthenticated, isSessionReady, setSession } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isSessionReady && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isSessionReady, router]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Yeni şifreler eşleşmiyor");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await authApi.changePassword(currentPassword, newPassword);
      setSession(result.user, result.accessToken);
      toast.success("Şifreniz güncellendi");
      router.replace("/dashboard");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Şifre değiştirilemedi");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isSessionReady || !isAuthenticated) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <section className="w-full max-w-md rounded-3xl border border-border bg-white p-8 shadow-card">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white">
            <KeyRound className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold text-text">Şifrenizi değiştirin</h1>
          <p className="mt-2 text-sm text-muted">
            {user?.mustChangePassword
              ? "Hesabınızın şifresi yönetici tarafından belirlendi. Devam etmek için kendi şifrenizi oluşturun."
              : "Yeni şifreniz en az 12 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir."}
          </p>
        </div>
        <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
          <PasswordField
            label="Mevcut şifre"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField label="Yeni şifre" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField
            label="Yeni şifre (tekrar)"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Kaydediliyor..." : "Şifreyi Güncelle"}
          </button>
        </form>
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-text">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="password"
        autoComplete={autoComplete}
        minLength={autoComplete === "new-password" ? 12 : 1}
        className="focus-ring w-full rounded-xl border border-border px-4 py-3 text-text"
        required
      />
    </label>
  );
}
