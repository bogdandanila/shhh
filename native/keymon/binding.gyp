{
  "targets": [
    {
      "target_name": "keymon",
      "sources": ["keymon.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "OTHER_CPLUSPLUSFLAGS": ["-ObjC++"]
      },
      "link_settings": {
        "libraries": ["-framework AppKit"]
      }
    }
  ]
}
