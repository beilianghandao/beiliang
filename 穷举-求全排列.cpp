#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

vector<vector<int>> perm(vector <int> &nums){
	int n = nums.size();
	vector<vector<int>> pm = {{nums[0]}};
	for (int i=1; i<n; i++){
		vector<vector<int>> pm1 = pm;
		pm.clear();
		for (auto it=pm1.begin(); it!=pm1.end(); it++){
			vector<int> e = (*it);
			for (int j=e.size(); j>=0; j--){
				vector<int> e1 = e;
				auto it = e1.begin() + j;
				e1.insert(it, nums[i]);
				pm.push_back(e1);
			}
		}
	}
	return pm;
} 

int main(){
	vector<int> nums {10, 20, 3, 14};
	vector<vector<int>> pm = perm(nums);
	cout << "所有排列的个数：" << pm.size() << endl;
	for (auto it=pm.begin(); it!=pm.end(); it++){
		vector<int> e = (*it);
		cout << " { ";
		for (auto it1=e.begin(); it1!=e.end(); it1++)
			cout<<*it1<<" ";
		cout << "} ";
	}
	cout << endl;
	
	cout << "使用next_permutaion求全排列\n";
	sort(nums.begin(), nums.end());
	do{
		cout << " { ";
		for (auto it1=nums.begin(); it1!=nums.end(); it1++)
			cout<<*it1<<" ";
		cout << "} ";
	}
	while(next_permutation(nums.begin(), nums.end()));
	return 0;
}

