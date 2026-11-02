# Applied to the apps that minify their release builds. The native code
# (JNI, fbjni) looks the classes, constructors, methods and fields of the
# library up by name: R8 must neither rename nor remove them.
-keep class com.azzapp.rnskv.** { *; }
