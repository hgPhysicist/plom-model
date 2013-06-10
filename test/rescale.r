data <- read.csv('data/data.csv', header=TRUE,  na.strings = 'null')
apply(data[,2:ncol(data[1,])], 2, mean, na.rm=TRUE)

hat <- read.csv('results/hat_0.csv', header=TRUE,  na.strings = 'null')
apply(hat[,2:ncol(hat[1,])], 2, mean, na.rm=TRUE)
