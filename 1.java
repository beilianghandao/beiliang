// 1. 输出内容
System.out.println("Hello World");

// 2. 定义变量
int age = 20;
String name = "Tom";
System.out.println(name + "今年" + age + "岁");

// 3. 简单计算
int a = 10;
int b = 20;
int sum = a + b;
System.out.println(sum);

// 4. if 判断
int score = 80;
if (score >= 60) {
    System.out.println("及格");
} else {
    System.out.println("不及格");
}

// 5. for 循环
for (int i = 1; i <= 5; i++) {
    System.out.println(i);
}

// 6. 数组
int[] nums = {10, 20, 30};
for (int num : nums) {
    System.out.println(num);
}

// 7. 简单方法
public static int add(int a, int b) {
    return a + b;
}