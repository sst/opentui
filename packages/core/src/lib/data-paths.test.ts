import { test, expect } from "bun:test"
import { DataPathsManager } from "./data-paths"

test("DataPathsManager validates appName", () => {
  const manager = new DataPathsManager()

  // Valid names should work
  expect(() => {
    manager.appName = "myapp"
  }).not.toThrow()

  expect(() => {
    manager.appName = "my-app"
  }).not.toThrow()

  expect(() => {
    manager.appName = "my_app"
  }).not.toThrow()

  expect(() => {
    manager.appName = "MyApp123"
  }).not.toThrow()

  // Invalid names should throw
  expect(() => {
    manager.appName = ""
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "   "
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app/name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app\\name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app<name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app>name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = 'app"name'
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app|name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app?name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app*name"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "CON"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "PRN"
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app."
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "app "
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = "."
  }).toThrow("Invalid app name")

  expect(() => {
    manager.appName = ".."
  }).toThrow("Invalid app name")
})

test("DataPathsManager constructor uses valid default appName", () => {
  // Should not throw when creating a new instance
  expect(() => {
    new DataPathsManager()
  }).not.toThrow()

  const manager = new DataPathsManager()
  expect(manager.appName).toBe("opentui")
})
