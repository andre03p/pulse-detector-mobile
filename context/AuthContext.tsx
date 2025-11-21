import { User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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
      // First, check if user already exists
      const { data: existingUsers, error: checkError } = await supabase.rpc(
        "check_user_exists",
        { email_input: email }
      );

      // If the RPC function doesn't exist, proceed with normal signup
      // (we'll create this function below)

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

        // Check for specific error messages
        if (error.message.includes("already registered")) {
          return {
            error: true,
            msg: "This email is already registered. Please log in instead.",
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

  const value = {
    onRegister: register,
    onLogin: login,
    onLogout: logout,
    authState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
