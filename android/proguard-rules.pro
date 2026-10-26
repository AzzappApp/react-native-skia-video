# Applied to the consuming app's release build (consumerProguardFiles).
# The C++ side resolves these classes, their constructors, methods and fields
# by name through fbjni, so R8 sees no Java caller and strips or renames them:
# install() then throws ClassNotFoundException on the first import.
-keep class com.azzapp.rnskv.** { *; }
