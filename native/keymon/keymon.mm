// NSEvent-based global key monitor. Unlike a CGEventTap (which macOS gates
// behind the Input Monitoring permission), NSEvent monitors need only
// Accessibility — and they deliver flagsChanged, so modifier keys including
// fn are observable. Observe-only: events cannot be consumed or modified.
//
// Global monitors cover other apps; local monitors cover our own windows.
// Monitors installed before Accessibility is granted never fire — the JS
// side installs them only once systemPreferences reports the app trusted.
#include <napi.h>
#import <AppKit/AppKit.h>

static NSMutableArray* g_monitors = nil;
static Napi::ThreadSafeFunction g_tsfn;
static bool g_running = false;

static void Emit(const char* type, NSEvent* e) {
  if (!g_running) return;
  std::string t(type);
  int keyCode = (int)e.keyCode;
  double flags = (double)e.modifierFlags;
  g_tsfn.NonBlockingCall([t, keyCode, flags](Napi::Env env, Napi::Function cb) {
    cb.Call({Napi::String::New(env, t), Napi::Number::New(env, keyCode), Napi::Number::New(env, flags)});
  });
}

static Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_running) return env.Undefined();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) requires a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  g_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "keymon", 0, 1);
  g_running = true;
  g_monitors = [NSMutableArray new];

  struct Kind { NSEventMask mask; const char* name; };
  static const Kind kinds[] = {
    {NSEventMaskKeyDown, "down"},
    {NSEventMaskKeyUp, "up"},
    {NSEventMaskFlagsChanged, "flags"},
  };
  for (const Kind& k : kinds) {
    const char* name = k.name;
    id global = [NSEvent addGlobalMonitorForEventsMatchingMask:k.mask
                                                       handler:^(NSEvent* e) { Emit(name, e); }];
    if (global) [g_monitors addObject:global];
    id local = [NSEvent addLocalMonitorForEventsMatchingMask:k.mask
                                                     handler:^NSEvent*(NSEvent* e) { Emit(name, e); return e; }];
    if (local) [g_monitors addObject:local];
  }
  return env.Undefined();
}

static Napi::Value Stop(const Napi::CallbackInfo& info) {
  if (!g_running) return info.Env().Undefined();
  g_running = false;
  for (id m in g_monitors) [NSEvent removeMonitor:m];
  g_monitors = nil;
  g_tsfn.Release();
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

NODE_API_MODULE(keymon, Init)
