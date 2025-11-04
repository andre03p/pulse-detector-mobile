import { createStackNavigator } from "@react-navigation/stack";
import Home from "../app/tabs/Home";
import Stats from "../app/tabs/Stats";
import History from "../app/tabs/History";
import Profile from "../app/tabs/Profile";
import Login from "../app/tabs/auth/Login";
import Register from "../app/tabs/auth/Register";
import ResetPass from "../app/tabs/auth/ResetPass";
import React from "react";
import { Stack } from "expo-router";

const StackNavigator = createStackNavigator();

export default function Navigation() {
  return (
    <StackNavigator.Navigator
      initialRouteName="Home"
      screenOptions={{ headerShown: false }}
    >
      <StackNavigator.Screen name="Home" component={Home} />
      <StackNavigator.Screen name="Login" component={Login} />
      <StackNavigator.Screen name="Register" component={Register} />
      <StackNavigator.Screen name="ResetPass" component={ResetPass} />
      <StackNavigator.Screen name="Stats" component={Stats} />
      <StackNavigator.Screen name="History" component={History} />
      <StackNavigator.Screen name="Profile" component={Profile} />
    </StackNavigator.Navigator>
  );
}


const FooterNavigation = () => {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>