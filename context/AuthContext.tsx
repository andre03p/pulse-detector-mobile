import { User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { createUserProfile } from "../lib/supabaseQueries";

interface AuthProps {
  authState?: {
    token: string | null;
    authenticated: boolean | null;
    user: User | null;
  };
  onRegister?: (name: string, email: string, password: string) => Promise<any>;
  onLogin?: (email: string, password: string) => Promise<any>;
  onLogout?: () => Promise<any>;
  onResetPassword?: (email: string) => Promise<any>;
  onVerifyOtpAndUpdatePassword?: (
    email: string,
    token: string,
    newPassword: string
  ) => Promise<any>;
  onSendVerificationCode?: (email: string) => Promise<any>;
  onVerifyEmailWithOtp?: (
    email: string,
    token: string,
    name: string,
    password: string
  ) => Promise<any>;
}

const AuthContext = createContext<AuthProps>({});

export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider = ({ children }: any) => {
  const [authState, setAuthState] = useState<{
    token: string | null;
    authenticated: boolean | null;
    user: User | null;
  }>({
    token: null,
    authenticated: null,
    user: null,
  });

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          setAuthState({
            token: session.access_token,
            authenticated: true,
            user: session.user,
          });
        } else {
          setAuthState({
            token: null,
            authenticated: false,
            user: null,
          });
        }
      } catch (error) {
        console.error("Session check error:", error);
        setAuthState({
          token: null,
          authenticated: false,
          user: null,
        });
      }
    };

    checkSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state changed:", event);

      if (session) {
        setAuthState({
          token: session.access_token,
          authenticated: true,
          user: session.user,
        });
      } else {
        setAuthState({
          token: null,
          authenticated: false,
          user: null,
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const register = async (name: string, email: string, password: string) => {
    try {
      const { data: existingUsers, error: checkError } = await supabase.rpc(
        "check_user_exists",
        { email_input: email }
      );

      const { data, error } = await supabase.auth.signUp({
        options: {
          data: {
            display_name: name,
          },
        },
        email,
        password,
      });

      if (error) {
        console.error("Supabase signup error:", error);

        if (error.message.includes("already registered")) {
          return {
            error: true,
            msg: "This email is already registered. Please log in instead.",
          };
        }

        if (
          error.message.includes("40 seconds") ||
          error.message.includes("rate limit")
        ) {
          return {
            error: true,
            msg: "Please wait a moment before trying again. Check your email for the verification code.",
          };
        }

        return { error: true, msg: error.message };
      }

      // When email confirmation is enabled, Supabase returns a user
      // but no session if the email already exists (to prevent enumeration)
      // We can detect this scenario
      if (data.user && !data.session && data.user.identities?.length === 0) {
        return {
          error: true,
          msg: "This email is already registered. Please log in instead.",
        };
      }

      // Create user profile in User table
      if (data.user?.id && data.user?.email) {
        await createUserProfile(data.user.id, data.user.email, name);
      }

      // Successful registration
      const successMsg = data.session
        ? "Registration successful!"
        : "Registration successful! Please check your email to verify your account.";

      return {
        error: false,
        msg: successMsg,
        data,
      };
    } catch (error: any) {
      console.error("Registration exception:", error);
      return { error: true, msg: error.message || "Registration failed" };
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: true, msg: error.message };
      }

      setAuthState({
        token: data.session?.access_token || null,
        authenticated: true,
        user: data.user,
      });

      return { error: false, msg: "Login successful!", data };
    } catch (error: any) {
      return { error: true, msg: error.message || "Login failed" };
    }
  };

  const logout = async () => {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        return { error: true, msg: error.message };
      }

      setAuthState({
        token: null,
        authenticated: false,
        user: null,
      });

      return { error: false, msg: "Logged out successfully" };
    } catch (error: any) {
      return { error: true, msg: error.message || "Logout failed" };
    }
  };

  const resetPassword = async (email: string) => {
    try {
      // Send OTP (one-time password) code instead of email link
      const { data, error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          shouldCreateUser: false, // Don't create new user, only allow existing users
        },
      });

      if (error) {
        console.error("Password reset error:", error);
        return { error: true, msg: error.message };
      }

      return {
        error: false,
        msg: "Verification code sent to your email",
        data,
      };
    } catch (error: any) {
      console.error("Password reset exception:", error);
      return {
        error: true,
        msg: error.message || "Failed to send verification code",
      };
    }
  };

  const verifyOtpAndUpdatePassword = async (
    email: string,
    token: string,
    newPassword: string
  ) => {
    try {
      // First, verify the OTP
      const { data: verifyData, error: verifyError } =
        await supabase.auth.verifyOtp({
          email: email,
          token: token,
          type: "email",
        });

      if (verifyError) {
        console.error("OTP verification error:", verifyError);
        return { error: true, msg: verifyError.message };
      }

      // If verification successful, update the password
      const { data: updateData, error: updateError } =
        await supabase.auth.updateUser({
          password: newPassword,
        });

      if (updateError) {
        console.error("Password update error:", updateError);
        return { error: true, msg: updateError.message };
      }

      // Sign out after password update
      await supabase.auth.signOut();

      return {
        error: false,
        msg: "Password updated successfully",
        data: updateData,
      };
    } catch (error: any) {
      console.error("Verify and update exception:", error);
      return {
        error: true,
        msg: error.message || "Failed to update password",
      };
    }
  };

  const sendVerificationCode = async (email: string) => {
    try {
      // For new registrations, we can't use OTP without creating user first
      // Instead, return success to proceed to next step
      // The actual account will be created in verifyEmailWithOtp
      return {
        error: false,
        msg: "Ready to create account",
        data: null,
      };
    } catch (error: any) {
      console.error("Send verification code exception:", error);
      return {
        error: true,
        msg: error.message || "Failed to send verification code",
      };
    }
  };

  const verifyEmailWithOtp = async (
    email: string,
    token: string,
    name: string,
    password: string
  ) => {
    try {
      // Create the account directly with email confirmation disabled
      // Since we're manually verifying with a code, we'll use signUp
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name,
            },
            // Let Supabase handle email confirmation
          },
        });

      if (signUpError) {
        console.error("Sign up error:", signUpError);
        return { error: true, msg: signUpError.message };
      }

      // Check if email confirmation is required
      if (signUpData.user && !signUpData.session) {
        // User created but needs email confirmation
        // Try to verify with the provided token
        const { data: verifyData, error: verifyError } =
          await supabase.auth.verifyOtp({
            email: email,
            token: token,
            type: "signup",
          });

        if (verifyError) {
          console.error("OTP verification error:", verifyError);
          return {
            error: true,
            msg: "Invalid verification code. Please check your email and try again.",
          };
        }

        // Sign out after verification
        await supabase.auth.signOut();

        return {
          error: false,
          msg: "Email verified! You can now log in.",
          data: verifyData,
        };
      }

      // If session exists, user is auto-logged in (email confirmation disabled)
      if (signUpData.session) {
        await supabase.auth.signOut();
      }

      return {
        error: false,
        msg: "Registration successful! You can now log in.",
        data: signUpData,
      };
    } catch (error: any) {
      console.error("Verify email with OTP exception:", error);
      return {
        error: true,
        msg: error.message || "Failed to verify email",
      };
    }
  };

  const value = {
    onRegister: register,
    onLogin: login,
    onLogout: logout,
    onResetPassword: resetPassword,
    onVerifyOtpAndUpdatePassword: verifyOtpAndUpdatePassword,
    onSendVerificationCode: sendVerificationCode,
    onVerifyEmailWithOtp: verifyEmailWithOtp,
    authState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
