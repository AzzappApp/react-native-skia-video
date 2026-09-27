# The C++ side finds these classes, methods and fields by name, and sets fields
# the Java side never writes: R8 would rename them, or fold them to their
# initial value.
-keep class com.azzapp.rnskv.** { *; }
